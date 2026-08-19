import type { IngestionMode } from '@/lib/ingestion/modes';
import { assessExtractedText, type AssessOptions, type TextAssessment } from '@/lib/ingestion/assess';
import {
  isOcrCapable,
  transcribeDocument,
  type OcrAttachment,
  type OcrOutcome,
} from '@/lib/ingestion/ocr';
import { EMPTY_USAGE, type TokenUsage } from '@/lib/metrics';
import {
  CLEAN_SECURITY_SUMMARY,
  sanitizeUntrustedDocument,
  toSecuritySummary,
  type SecuritySummary,
} from '@/lib/security/prompt-injection';

/**
 * Pipeline di acquisizione dei contratti.
 *
 * Un percorso unico per tre casi che l'utente non distingue e non dovrebbe
 * distinguere: un testo incollato, un PDF con testo selezionabile, una scansione.
 * Chi carica un contratto non sa se il suo PDF sia testuale — è un dettaglio di
 * come è stato prodotto il file, spesso anni prima, da qualcun altro.
 *
 * Il ripiego su lettura visiva è **trasparente ma non silenzioso**: avviene senza
 * che l'utente debba chiedere nulla, e viene dichiarato nel risultato, perché
 * cambia ciò che le citazioni verificate dimostrano.
 */

export { INGESTION_MODES, MODE_LABELS, type IngestionMode } from '@/lib/ingestion/modes';

export interface OcrSummary {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly pageCount: number | null;
  readonly legiblePages: number | null;
  readonly confidence: number | null;
  readonly hasHandwriting: boolean;
  readonly hasSignatures: boolean;
  readonly failureReason: string | null;
}

export const NO_OCR: OcrSummary = {
  attempted: false,
  succeeded: false,
  pageCount: null,
  legiblePages: null,
  confidence: null,
  hasHandwriting: false,
  hasSignatures: false,
  failureReason: null,
};

export interface IngestionSummary {
  readonly mode: IngestionMode;
  readonly assessment: TextAssessment;
  readonly ocr: OcrSummary;
  /**
   * True quando il testo su cui gira l'audit è una trascrizione generata da un
   * modello. Cambia il significato di una citazione verificata, quindi deve
   * arrivare fino al report.
   */
  readonly sourceIsTranscript: boolean;
  readonly warnings: readonly string[];
}

export interface IngestionOutcome {
  readonly summary: IngestionSummary;
  readonly security: SecuritySummary;
  /** Testo per l'audit e per la verifica delle citazioni; `null` se non ricavabile. */
  readonly text: string | null;
  /** Allegato da inoltrare al modello quando non c'è testo utilizzabile. */
  readonly attachment: OcrAttachment | null;
  readonly usage: TokenUsage;
  readonly modelId: string | null;
  readonly latencyMs: number;
}

export interface IngestionInput {
  readonly text?: string | undefined;
  readonly attachment?: OcrAttachment | undefined;
  readonly pageCount?: number | null | undefined;
}

export interface IngestionDependencies {
  readonly transcribe: (attachment: OcrAttachment) => Promise<OcrOutcome>;
  /** Consente di disattivare la lettura visiva senza toccare il resto del percorso. */
  readonly ocrEnabled: boolean;
}

export const defaultIngestionDependencies: IngestionDependencies = {
  transcribe: transcribeDocument,
  ocrEnabled: true,
};

function assess(text: string | null, options: AssessOptions): TextAssessment {
  return assessExtractedText(text, options);
}

/**
 * Acquisisce un documento.
 *
 * Ordine delle decisioni:
 * 1. C'è testo di qualità? Si usa quello — nessuna chiamata al modello, costo zero.
 * 2. Il testo manca o è degradato e c'è un allegato leggibile? Trascrizione.
 * 3. La trascrizione non è disponibile o fallisce? L'allegato passa al modello di
 *    audit così com'è: si perde la verificabilità delle citazioni, ma l'analisi
 *    avviene comunque. Un guasto nell'OCR non deve far fallire l'intero audit.
 * 4. Non c'è nulla di utilizzabile? Si dice, invece di analizzare il vuoto.
 */
export async function ingestDocument(
  input: IngestionInput,
  overrides: Partial<IngestionDependencies> = {},
): Promise<IngestionOutcome> {
  const deps: IngestionDependencies = { ...defaultIngestionDependencies, ...overrides };
  const startedAt = Date.now();
  const warnings: string[] = [];

  const providedText = input.text !== undefined && input.text.trim().length > 0 ? input.text : null;
  const assessment = assess(providedText, { pageCount: input.pageCount ?? null });

  // ── 1. Testo utilizzabile: si procede senza spendere un token ─────────────
  if (!assessment.needsOcr && providedText !== null) {
    const sanitization = sanitizeUntrustedDocument(providedText);
    return {
      summary: {
        mode: 'text',
        assessment,
        ocr: NO_OCR,
        sourceIsTranscript: false,
        warnings,
      },
      security: toSecuritySummary(sanitization),
      text: sanitization.sanitized,
      attachment: null,
      usage: EMPTY_USAGE,
      modelId: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  const attachment = input.attachment ?? null;

  // ── 2. Niente da leggere ──────────────────────────────────────────────────
  if (attachment === null) {
    if (providedText === null) {
      return {
        summary: {
          mode: 'text',
          assessment,
          ocr: NO_OCR,
          sourceIsTranscript: false,
          warnings: ['Nessun documento da analizzare: né testo né allegato.'],
        },
        security: CLEAN_SECURITY_SUMMARY,
        text: null,
        attachment: null,
        usage: EMPTY_USAGE,
        modelId: null,
        latencyMs: Date.now() - startedAt,
      };
    }

    // Testo scarso ma è tutto ciò che c'è: si procede dichiarandolo.
    warnings.push(
      `${assessment.reason} Non è stato fornito un allegato da cui recuperare il testo mancante, ` +
        "quindi l'audit gira su un documento probabilmente incompleto.",
    );
    const sanitization = sanitizeUntrustedDocument(providedText);
    return {
      summary: { mode: 'text', assessment, ocr: NO_OCR, sourceIsTranscript: false, warnings },
      security: toSecuritySummary(sanitization),
      text: sanitization.sanitized,
      attachment: null,
      usage: EMPTY_USAGE,
      modelId: null,
      latencyMs: Date.now() - startedAt,
    };
  }

  // ── 3. Lettura visiva ─────────────────────────────────────────────────────
  const mode: IngestionMode = providedText === null ? 'ocr_primary' : 'ocr_fallback';

  if (!deps.ocrEnabled || !isOcrCapable(attachment.mediaType)) {
    const reason = !deps.ocrEnabled
      ? 'La lettura visiva è disattivata.'
      : `Il tipo ${attachment.mediaType} non è leggibile visivamente.`;
    return passthrough(attachment, assessment, reason, startedAt, [
      ...warnings,
      `${reason} L'allegato viene analizzato direttamente: le citazioni non saranno verificabili.`,
    ]);
  }

  try {
    const ocr = await deps.transcribe(attachment);
    const transcriptAssessment = assess(ocr.text, { pageCount: ocr.pageCount });

    if (transcriptAssessment.quality === 'empty') {
      return passthrough(
        attachment,
        transcriptAssessment,
        'La trascrizione non ha prodotto testo utilizzabile.',
        startedAt,
        [
          ...warnings,
          "La lettura visiva non ha prodotto testo: l'allegato viene analizzato direttamente.",
        ],
        ocr.usage,
        ocr.modelId,
      );
    }

    if (ocr.legiblePages < ocr.pageCount) {
      warnings.push(
        `${ocr.pageCount - ocr.legiblePages} pagine su ${ocr.pageCount} non sono leggibili: ` +
          'il loro contenuto non compare nel testo analizzato e non va interpretato come assente dal contratto.',
      );
    }
    if (ocr.confidence < 0.7) {
      warnings.push(
        `Confidenza di trascrizione bassa (${Math.round(ocr.confidence * 100)}%): ` +
          'verifica i rilievi sul documento originale prima di usarli.',
      );
    }
    if (ocr.hasHandwriting) {
      warnings.push(
        'Il documento contiene annotazioni manoscritte: potrebbero modificare clausole stampate ' +
          'senza che la trascrizione ne colga la portata.',
      );
    }

    const sanitization = sanitizeUntrustedDocument(ocr.text);

    return {
      summary: {
        mode,
        assessment: transcriptAssessment,
        ocr: {
          attempted: true,
          succeeded: true,
          pageCount: ocr.pageCount,
          legiblePages: ocr.legiblePages,
          confidence: ocr.confidence,
          hasHandwriting: ocr.hasHandwriting,
          hasSignatures: ocr.hasSignatures,
          failureReason: null,
        },
        sourceIsTranscript: true,
        warnings,
      },
      security: toSecuritySummary(sanitization),
      text: sanitization.sanitized,
      attachment: null,
      usage: ocr.usage,
      modelId: ocr.modelId,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    // Un guasto nella trascrizione degrada, non interrompe: l'audit resta
    // possibile sull'allegato, con meno garanzie e detto chiaramente.
    const reason = error instanceof Error ? error.message : 'Errore sconosciuto nella lettura visiva.';
    console.warn('[ingestion] lettura visiva fallita, ripiego sull\'allegato', { reason });
    return passthrough(attachment, assessment, reason, startedAt, [
      ...warnings,
      `Lettura visiva non riuscita (${reason}). L'allegato viene analizzato direttamente: ` +
        'le citazioni non saranno verificabili.',
    ]);
  }
}

function passthrough(
  attachment: OcrAttachment,
  assessment: TextAssessment,
  failureReason: string,
  startedAt: number,
  warnings: readonly string[],
  usage: TokenUsage = EMPTY_USAGE,
  modelId: string | null = null,
): IngestionOutcome {
  return {
    summary: {
      mode: 'attachment_passthrough',
      assessment,
      ocr: { ...NO_OCR, attempted: modelId !== null, succeeded: false, failureReason },
      sourceIsTranscript: false,
      warnings,
    },
    // Senza testo estratto non c'è nulla da ispezionare: dichiararlo "pulito"
    // sarebbe una rassicurazione non guadagnata.
    security: CLEAN_SECURITY_SUMMARY,
    text: null,
    attachment,
    usage,
    modelId,
    latencyMs: Date.now() - startedAt,
  };
}
