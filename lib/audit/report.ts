import {
  CATEGORY_LABELS,
  SEVERITY_LABELS,
  type ContractAudit,
  type RiskBand,
} from '@/lib/audit/schema';
import { STAGE_LABELS } from '@/lib/audit/telemetry';

/**
 * Composizione del report esecutivo.
 *
 * Modulo puro: dallo stesso audit esce sempre lo stesso documento. Il report è
 * ciò che finisce sul tavolo di chi decide, e non deve cambiare di run in run
 * perché una seconda generazione ha riformulato le frasi.
 */

export const BAND_LABELS: Readonly<Record<RiskBand, string>> = {
  low: 'Basso',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Critico',
};

/**
 * Giudizio operativo per fascia.
 *
 * Un audit che si ferma al punteggio lascia a chi legge la domanda che conta —
 * "quindi firmo o no?" — e quella domanda è esattamente il motivo per cui
 * l'audit è stato commissionato.
 */
export const BAND_VERDICTS: Readonly<Record<RiskBand, string>> = {
  low: 'Nessun ostacolo alla firma emerso dai controlli applicati. Restano raccomandazioni migliorative da valutare al rinnovo.',
  medium:
    'Firmabile previa negoziazione dei rilievi di priorità 1 e 2. Nessuno degli scostamenti rilevati è di per sé bloccante.',
  high: 'Sconsigliata la firma nella forma attuale. I rilievi di priorità 1 e 2 vanno chiusi prima della sottoscrizione.',
  critical:
    'Non firmare senza revisione legale. Sono presenti rilievi critici che espongono a sanzione, interruzione del servizio o responsabilità non limitata.',
};

/**
 * Avviso di manomissione del documento.
 *
 * Sta **fuori** dall'elenco dei rilievi, e la scelta è deliberata. `redFlags`
 * ha un invariante: ogni voce porta una citazione ritrovata nel documento. Un
 * rilievo sintetico sui caratteri invisibili non può averla — quei caratteri
 * sono stati rimossi, e citarli è impossibile per costruzione — quindi
 * infilarlo lì dentro romperebbe proprio il controllo che rende credibile tutto
 * il resto, e falserebbe il conteggio di affidabilità delle citazioni.
 *
 * Non per questo è un dettaglio minore: è probabilmente l'informazione più
 * importante dell'intero audit, perché non parla del contratto ma della
 * controparte. Compare quindi in testa al report, accanto al giudizio, dove non
 * si può non vederla.
 */
export function securityWarning(audit: ContractAudit): string | null {
  const security = audit.metadata.security;
  if (!security.scanned) return null;

  if (security.hasHiddenContent) {
    return (
      `**Il documento contiene ${security.removedCharacters} caratteri invisibili.** Si tratta di ` +
      'testo che nessun lettore umano vede e che un sistema automatico legge come contenuto. ' +
      "In un contratto non esiste un uso legittimo di questi caratteri: prima di dare peso a " +
      "quest'analisi, verifica il documento in originale e valuta la circostanza con chi lo ha trasmesso."
    );
  }

  const steering = security.findings.filter(
    (finding) => finding.kind === 'output_steering' || finding.kind === 'instruction_override',
  );
  if (steering.length > 0) {
    return (
      'Il documento contiene frasi rivolte a un sistema automatico, che tentano di indirizzarne ' +
      "l'esito. Sono state trattate come testo del contratto e non eseguite, ma la loro presenza " +
      'in un documento contrattuale merita una spiegazione da parte di chi lo ha redatto.'
    );
  }

  return null;
}

/**
 * Che cosa dimostra, esattamente, una citazione verificata.
 *
 * Su un testo incollato dimostra che il passaggio è nel documento. Su una
 * scansione trascritta dal modello dimostra che è nella *trascrizione*, che è
 * un'affermazione più debole. Confondere le due cose significa attribuire a un
 * audit una solidità che non ha, ed è il genere di sfumatura che sparisce
 * quando il report viene letto sei mesi dopo da qualcun altro.
 */
export function provenanceNote(audit: ContractAudit): string {
  const { ingestion } = audit.metadata;

  if (ingestion.mode === 'attachment_passthrough') {
    return (
      "Il documento è stato analizzato come allegato, senza estrazione del testo: le citazioni " +
      'non sono state verificate contro alcun sorgente e vanno controllate a mano.'
    );
  }

  if (ingestion.sourceIsTranscript) {
    const confidence = ingestion.ocr.confidence;
    return (
      'Il documento era una scansione: il testo analizzato è una trascrizione prodotta ' +
      `automaticamente${confidence !== null ? ` (confidenza ${Math.round(confidence * 100)}%)` : ''}. ` +
      'Le citazioni verificate dimostrano che il rilievo è coerente con la trascrizione, non con ' +
      "l'originale scansionato: per un uso negoziale, riscontrale sul documento firmato."
    );
  }

  return 'Le citazioni sono state verificate contro il testo del documento fornito.';
}

export interface ExecutiveSummary {
  readonly auditId: string;
  readonly sourceName: string;
  readonly generatedAt: string;
  readonly score: number;
  readonly band: RiskBand;
  readonly bandLabel: string;
  readonly verdict: string;
  readonly counts: ContractAudit['riskScore']['counts'];
  readonly topRisks: readonly { title: string; severity: string; category: string }[];
  readonly immediateActions: readonly { priority: number; title: string; action: string }[];
  readonly slaBreachCount: number;
  readonly missingClauseCount: number;
  /** Quota di citazioni confermate nel documento: la misura di affidabilità dell'audit. */
  readonly citationReliability: number | null;
  readonly coverageComplete: boolean;
  /** Avviso di manomissione del documento; `null` se la scansione non ha trovato nulla. */
  readonly securityWarning: string | null;
  /** Che cosa dimostra una citazione verificata, dato come è stato letto il documento. */
  readonly provenanceNote: string;
  readonly costUsd: number | null;
  readonly totalTokens: number;
  readonly disclaimer: string;
}

/** Quota di citazioni confermate; `null` quando non c'era testo su cui verificare. */
export function citationReliability(audit: ContractAudit): number | null {
  const { total, verified } = audit.citationAudit;
  if (total === 0) return null;
  return Math.round((verified / total) * 100) / 100;
}

export function buildExecutiveSummary(audit: ContractAudit): ExecutiveSummary {
  const topRisks = [...audit.redFlags]
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
    .slice(0, 5)
    .map((flag) => ({
      title: flag.title,
      severity: SEVERITY_LABELS[flag.severity],
      category: CATEGORY_LABELS[flag.category],
    }));

  const immediateActions = audit.recommendations
    .filter((recommendation) => recommendation.priority <= 2)
    .slice(0, 8)
    .map((recommendation) => ({
      priority: recommendation.priority,
      title: recommendation.title,
      action: recommendation.action,
    }));

  return {
    auditId: audit.auditId,
    sourceName: audit.sourceName,
    generatedAt: audit.generatedAt,
    score: audit.riskScore.overall,
    band: audit.riskScore.band,
    bandLabel: BAND_LABELS[audit.riskScore.band],
    verdict: BAND_VERDICTS[audit.riskScore.band],
    counts: audit.riskScore.counts,
    topRisks,
    immediateActions,
    slaBreachCount: audit.slaViolations.length,
    missingClauseCount: audit.missingClauses.length,
    citationReliability: citationReliability(audit),
    coverageComplete: audit.clausesAssessed === audit.clausesInCatalog,
    securityWarning: securityWarning(audit),
    provenanceNote: provenanceNote(audit),
    costUsd: audit.metadata.telemetry.costUsd,
    totalTokens: audit.metadata.telemetry.totalTokens,
    disclaimer: audit.disclaimer,
  };
}

function severityRank(severity: keyof typeof SEVERITY_LABELS): number {
  return { critical: 0, high: 1, medium: 2, low: 3 }[severity];
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toISOString().slice(0, 10);
}

/**
 * Report esecutivo in Markdown.
 *
 * Markdown e non HTML perché è il formato che sopravvive al passaggio in una
 * mail, in un ticket e in un documento: chi riceve l'audit lo inoltra, e un
 * report che si legge solo dentro la nostra interfaccia non viene inoltrato.
 */
export function buildExecutiveReport(audit: ContractAudit): string {
  const summary = buildExecutiveSummary(audit);
  const lines: string[] = [];

  lines.push(`# Audit di conformità contrattuale — ${audit.sourceName}`);
  lines.push('');
  lines.push(`**Esito: rischio ${summary.bandLabel.toUpperCase()} — ${summary.score}/100**`);
  lines.push('');
  lines.push(summary.verdict);
  lines.push('');

  // L'avviso di manomissione precede tutto il resto: non parla del contratto,
  // parla di chi lo ha trasmesso, e chi legge deve incontrarlo prima di farsi
  // un'idea sui rilievi.
  if (summary.securityWarning !== null) {
    lines.push(`> ⚠️ **Attenzione — integrità del documento**`);
    lines.push('>');
    lines.push(`> ${summary.securityWarning.replace(/\n/g, ' ')}`);
    lines.push('');
  }
  lines.push(
    `| Audit | Data | Documento | Rilievi | SLA disattesi | Clausole mancanti |`,
  );
  lines.push('|---|---|---|---|---|---|');
  lines.push(
    `| \`${audit.auditId}\` | ${formatDate(audit.generatedAt)} | ${audit.findings.documentType} | ` +
      `${audit.redFlags.length} | ${audit.slaViolations.length} | ${audit.missingClauses.length} |`,
  );
  lines.push('');

  // ── Punteggio ─────────────────────────────────────────────────────────────
  lines.push('## Punteggio di rischio');
  lines.push('');
  lines.push(audit.riskScore.rationale);
  lines.push('');
  lines.push('| Area | Punteggio |');
  lines.push('|---|---|');
  for (const [category, score] of Object.entries(audit.riskScore.byCategory)) {
    if (score === 0) continue;
    lines.push(`| ${CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS]} | ${score}/100 |`);
  }
  lines.push('');

  // ── Azioni immediate ──────────────────────────────────────────────────────
  if (summary.immediateActions.length > 0) {
    lines.push('## Azioni prima della firma');
    lines.push('');
    for (const action of summary.immediateActions) {
      lines.push(`${action.priority}. **${action.title}** — ${action.action}`);
    }
    lines.push('');
  }

  // ── Rilievi ───────────────────────────────────────────────────────────────
  if (audit.redFlags.length > 0) {
    lines.push('## Rilievi con evidenza');
    lines.push('');
    for (const flag of audit.redFlags) {
      const badge =
        flag.citation.verification === 'verified'
          ? 'citazione confermata'
          : flag.citation.verification === 'partial'
            ? 'citazione parzialmente confermata'
            : flag.citation.verification === 'no-source'
              ? 'citazione non verificabile (nessun testo sorgente)'
              : '⚠ CITAZIONE NON TROVATA NEL DOCUMENTO';
      lines.push(
        `### ${SEVERITY_LABELS[flag.severity]} · ${CATEGORY_LABELS[flag.category]} — ${flag.title}`,
      );
      lines.push('');
      lines.push(flag.finding);
      lines.push('');
      lines.push(`> ${flag.citation.quote.replace(/\n/g, ' ')}`);
      lines.push(
        `> — ${flag.citation.locator ?? 'posizione non indicata'} · _${badge}_`,
      );
      lines.push('');
      lines.push(`**Impatto:** ${flag.businessImpact}`);
      lines.push('');
      lines.push(`**Azione suggerita:** ${flag.suggestedAction}`);
      lines.push('');
    }
  }

  // ── Clausole mancanti ─────────────────────────────────────────────────────
  if (audit.missingClauses.length > 0) {
    lines.push('## Clausole assenti o incomplete');
    lines.push('');
    lines.push('| Clausola | Stato | Gravità | Riferimento |');
    lines.push('|---|---|---|---|');
    for (const clause of audit.missingClauses) {
      const status = clause.status === 'partial' ? 'Incompleta' : 'Assente';
      lines.push(
        `| ${clause.name} | ${status} | ${SEVERITY_LABELS[clause.severity]} | ${clause.reference ?? '—'} |`,
      );
    }
    lines.push('');
  }

  // ── SLA ───────────────────────────────────────────────────────────────────
  if (audit.slaViolations.length > 0) {
    lines.push('## Livelli di servizio disattesi');
    lines.push('');
    lines.push('| Metrica | Impegno | Osservato | Gravità | Credito stimato |');
    lines.push('|---|---|---|---|---|');
    for (const violation of audit.slaViolations) {
      const credit =
        violation.estimatedCreditValue !== null
          ? `${violation.estimatedCreditValue} (${violation.penaltyPercent}%)`
          : violation.penaltyPercent !== null
            ? `${violation.penaltyPercent}% del canone`
            : 'nessuna penale prevista';
      lines.push(
        `| ${violation.description} | ${violation.committed}${violation.unit} | ` +
          `${violation.observed}${violation.unit} | ${SEVERITY_LABELS[violation.severity]} | ${credit} |`,
      );
    }
    lines.push('');
  }

  // ── Affidabilità ──────────────────────────────────────────────────────────
  lines.push('## Affidabilità di questa analisi');
  lines.push('');
  lines.push(summary.provenanceNote);
  lines.push('');
  if (summary.citationReliability === null) {
    lines.push(
      'Le citazioni non sono state verificate: il documento è stato analizzato come allegato ' +
        'senza testo estratto, quindi non esiste un sorgente su cui confrontarle.',
    );
  } else {
    lines.push(
      `${audit.citationAudit.verified} citazioni su ${audit.citationAudit.total} sono state ` +
        `ritrovate alla lettera nel documento (${Math.round(summary.citationReliability * 100)}%). ` +
        (audit.citationAudit.unverified > 0
          ? `**${audit.citationAudit.unverified} non sono state trovate e vanno controllate a mano prima di qualunque uso negoziale.**`
          : 'Nessuna citazione risulta priva di riscontro.'),
    );
  }
  lines.push('');
  if (!summary.coverageComplete) {
    lines.push(
      `Copertura del catalogo incompleta: ${audit.clausesAssessed} clausole valutate su ` +
        `${audit.clausesInCatalog}. Le clausole non valutate non compaiono fra le mancanti, ` +
        'perché un rilievo senza evidenza non è un rilievo.',
    );
    lines.push('');
  }

  for (const warning of audit.metadata.ingestion.warnings) {
    lines.push(`- ${warning}`);
  }
  if (audit.metadata.ingestion.warnings.length > 0) lines.push('');

  // ── Costo ─────────────────────────────────────────────────────────────────
  const telemetry = audit.metadata.telemetry;
  if (telemetry.stages.length > 0) {
    lines.push('## Costo di questa analisi');
    lines.push('');
    lines.push('| Fase | Modello | Token | Costo stimato | Durata |');
    lines.push('|---|---|---|---|---|');
    for (const stage of telemetry.stages) {
      lines.push(
        `| ${STAGE_LABELS[stage.stage]} | ${stage.modelId ?? '—'} | ` +
          `${stage.totalTokens.toLocaleString('it-IT')} | ${formatUsd(stage.costUsd)} | ` +
          `${(stage.latencyMs / 1000).toFixed(1)} s |`,
      );
    }
    lines.push(
      `| **Totale** | | **${telemetry.totalTokens.toLocaleString('it-IT')}** | ` +
        `**${formatUsd(telemetry.costUsd)}** | **${(telemetry.latencyMs / 1000).toFixed(1)} s** |`,
    );
    lines.push('');
    lines.push(
      '_Il costo è una stima basata sul listino pubblico del modello' +
        (telemetry.costComplete
          ? '.'
          : '; una delle fasi usa un modello a listino ignoto, quindi il totale è per difetto.') +
        ' Il dato fatturato resta quello del fornitore._',
    );
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`_${audit.disclaimer}_`);

  return lines.join('\n');
}

function formatUsd(value: number | null): string {
  if (value === null) return 'n/d';
  if (value === 0) return '$0';
  return value < 0.01 ? `$${value.toFixed(5)}` : `$${value.toFixed(4)}`;
}
