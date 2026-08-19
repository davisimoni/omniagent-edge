import { hasModelCredentials, getModelId } from '@/lib/ai/model';
import { CLAUSE_CATALOG } from '@/lib/audit/clauses';
import {
  assembleAudit,
  buildAuditContext,
  prepareAuditInput,
  streamAuditFindings,
  toAuditMetadata,
  type AuditInput,
} from '@/lib/audit/engine';
import { auditRequestSchema, type ContractAudit } from '@/lib/audit/schema';
import type { AuditPersistence, AuditStreamEvent } from '@/lib/audit/stream';
import { getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';
import type { AuthenticatedAccount } from '@/lib/auth/repository';
import { saveAudit } from '@/lib/audits/repository';
import { checkAuditQuota, recordUsage, type QuotaVerdict } from '@/lib/billing/quota';
import { hasFeature } from '@/lib/billing/plans';
import { buildAlert, dispatchAudit, getNotificationSettings } from '@/lib/notifications/dispatch';
import { readEnv } from '@/lib/env';
import { buildAuditTelemetry } from '@/lib/audit/telemetry';
import { assessExtractedText } from '@/lib/ingestion/assess';
import { normalizeUsage } from '@/lib/metrics';
import { base64ByteLength, MAX_ATTACHMENT_BYTES } from '@/lib/schemas';

/**
 * Audit di conformità contrattuale, in streaming.
 *
 * Risponde NDJSON invece che un JSON unico perché un audit su un contratto di
 * quaranta pagine impiega decine di secondi: senza avanzamento l'utente non ha
 * modo di distinguere un'analisi in corso da una richiesta bloccata, e il tempo
 * di attesa senza segnale è la ragione più comune per cui si ricarica la pagina
 * a metà di un'operazione costosa.
 *
 * Lo stream porta anche gli errori: una volta iniziata la risposta lo status HTTP
 * è già stato spedito, quindi un guasto a metà analisi deve viaggiare come evento
 * dentro il corpo, non come codice di stato.
 */
export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

/**
 * Vale la pena annunciare la trascrizione?
 *
 * Serve a decidere se mostrare la fase 'transcribing' *prima* di iniziarla: la
 * pipeline lo saprebbe con certezza solo dopo, e a quel punto l'utente avrebbe
 * gia' fissato una barra ferma per il tempo di una lettura visiva completa.
 * La stessa valutazione che usa la pipeline, applicata in anticipo.
 */
function needsTranscription(input: AuditInput): boolean {
  if (input.attachment === undefined) return false;
  return assessExtractedText(input.text ?? null).needsOcr;
}

/**
 * Archivia l'audit, scala il credito e avvisa il team.
 *
 * Non lancia mai. È eseguita dopo che il risultato è già stato spedito al
 * client, quindi un'eccezione qui non produrrebbe un errore utile: cadrebbe
 * dentro uno stream già aperto, dove diventa illeggibile. Ogni fallimento
 * diventa invece un motivo dichiarato nell'evento `persisted`.
 *
 * L'ordine è deliberato: prima si salva, poi si scala il credito, poi si
 * notifica. Scalare per primo addebiterebbe un audit che non è stato archiviato;
 * notificare per primo manderebbe un avviso con un link a un report inesistente.
 */
async function persist(
  account: AuthenticatedAccount | null,
  audit: ContractAudit,
): Promise<AuditPersistence> {
  if (account === null) {
    return {
      recordId: null,
      reason: isAuthAvailable()
        ? 'Accedi per salvare gli audit nella cronologia del tuo workspace.'
        : 'Archivio non disponibile su questa installazione (DATABASE_URL non configurata).',
      remaining: null,
      notified: [],
    };
  }

  let recordId: string | null = null;
  try {
    const record = await saveAudit({
      organizationId: account.organization.id,
      userId: account.user.id,
      audit,
    });
    recordId = record.id;
  } catch (error) {
    console.error('[api/audit] archiviazione fallita', error);
    return {
      recordId: null,
      reason: 'L\'audit è stato completato ma non è stato possibile archiviarlo. Esportalo ora.',
      remaining: null,
      notified: [],
    };
  }

  let remaining: number | null = null;
  try {
    await recordUsage({
      organizationId: account.organization.id,
      userId: account.user.id,
      kind: 'audit',
      costUsd: audit.metadata.telemetry.costUsd,
    });
    const updated = await checkAuditQuota(account.organization.id, account.organization.plan);
    remaining = updated.remaining;
  } catch (error) {
    // Un credito non contato costa a noi. È il verso giusto in cui sbagliare.
    console.error('[api/audit] registrazione consumo fallita', error);
  }

  let notified: AuditPersistence['notified'] = [];
  try {
    if (hasFeature(account.organization.plan, 'teamNotifications')) {
      const settings = await getNotificationSettings(account.organization.id);
      const baseUrl = readEnv('NEXT_PUBLIC_APP_URL') ?? null;
      const result = await dispatchAudit(buildAlert(audit, baseUrl, recordId), settings);
      notified = result.results.map((entry) => ({
        channel: entry.channel,
        delivered: entry.delivered,
        reason: entry.reason,
      }));
    }
  } catch (error) {
    console.error('[api/audit] notifiche fallite', error);
  }

  return { recordId, reason: null, remaining, notified };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = auditRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_request',
      message: 'Payload non valido.',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const { text, attachment, sourceName, observedMetrics, annualValueOverride } = parsed.data;

  if (attachment !== undefined && base64ByteLength(attachment.data) > MAX_ATTACHMENT_BYTES) {
    return json(413, {
      error: 'attachment_too_large',
      message: `L'allegato supera il limite di ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB.`,
    });
  }

  if (!hasModelCredentials()) {
    return json(503, {
      error: 'model_unavailable',
      message:
        'ANTHROPIC_API_KEY non è configurata. Copia .env.example in .env.local e ' +
        'inserisci la chiave, oppure impostala fra le Environment Variables su Vercel.',
    });
  }

  // ── Quota ────────────────────────────────────────────────────────────────
  // Il controllo precede l'analisi: superarlo dopo significherebbe aver già
  // pagato i token di un audit che poi rifiutiamo di consegnare. Chi non è
  // autenticato passa di qui senza quota di piano — il suo tetto è quello per
  // indirizzo applicato dal middleware — e il suo audit non viene archiviato.
  const account = await getCurrentAccount();
  let quota: QuotaVerdict | null = null;

  if (account !== null) {
    try {
      quota = await checkAuditQuota(account.organization.id, account.organization.plan);
    } catch (error) {
      // Fail-closed: un guasto del database non deve trasformarsi in audit
      // illimitati per chiunque se ne accorga.
      console.error('[api/audit] verifica quota fallita', error);
      return json(503, {
        error: 'quota_check_failed',
        message: 'Non è stato possibile verificare la quota. Riprova fra un momento.',
      });
    }

    if (!quota.allowed) {
      return json(402, {
        error: 'quota_exceeded',
        message: quota.message,
        plan: quota.plan,
        limit: quota.limit,
        used: quota.used,
        resetsAt: quota.resetsAt,
        suggestedPlan: quota.suggestedPlan,
      });
    }
  }

  const input = {
    text,
    attachment,
    sourceName,
    observedMetrics: observedMetrics ?? [],
    annualValueOverride: annualValueOverride ?? null,
  };
  const modelId = getModelId();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AuditStreamEvent): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: 'phase', phase: 'reading' });

        // Acquisizione: valuta il testo, ripiega sulla lettura visiva se il PDF
        // è una scansione, e in entrambi i casi passa dalla scansione
        // anti-injection prima che una sola riga raggiunga il modello di audit.
        if (needsTranscription(input)) send({ type: 'phase', phase: 'transcribing' });
        const { ingestion, modelInput } = await prepareAuditInput(input);
        const context = buildAuditContext({ ...input, text: modelInput.text });

        if (ingestion.text === null && ingestion.attachment === null) {
          send({
            type: 'error',
            error: 'no_readable_content',
            message:
              'Non è stato possibile ricavare testo dal documento. Incolla il contenuto oppure ' +
              'carica un PDF leggibile.',
          });
          return;
        }

        const analysisStartedAt = Date.now();
        const result = streamAuditFindings(modelInput);
        send({ type: 'phase', phase: 'analyzing' });

        // Si emette solo quando un conteggio cambia davvero: un evento per ogni
        // delta del modello significherebbe centinaia di messaggi che dicono la
        // stessa cosa, e una barra che sfarfalla invece di avanzare.
        let lastSignature = '';
        for await (const partial of result.partialObjectStream) {
          const clausesAssessed = partial.clauseAssessments?.length ?? 0;
          const redFlags = partial.redFlags?.length ?? 0;
          const slaCommitments = partial.slaCommitments?.length ?? 0;
          const signature = `${clausesAssessed}:${redFlags}:${slaCommitments}`;
          if (signature === lastSignature) continue;
          lastSignature = signature;
          send({
            type: 'progress',
            clausesAssessed,
            clausesTotal: CLAUSE_CATALOG.length,
            redFlags,
            slaCommitments,
          });
        }

        const findings = await result.object;

        send({ type: 'phase', phase: 'verifying' });
        const analysisUsage = normalizeUsage(await result.usage);

        // La telemetria è per fase: su una scansione la trascrizione e l'analisi
        // hanno profili di consumo opposti, e un totale unico nasconde quale
        // delle due sta effettivamente spendendo.
        const telemetry = buildAuditTelemetry(
          [
            {
              stage: 'ingestion',
              modelId: ingestion.modelId,
              usage: ingestion.usage,
              latencyMs: ingestion.latencyMs,
            },
            {
              stage: 'analysis',
              modelId,
              usage: analysisUsage,
              latencyMs: Date.now() - analysisStartedAt,
            },
          ],
          Date.now() - startedAt,
        );

        send({ type: 'phase', phase: 'scoring' });
        const audit = assembleAudit(
          findings,
          context,
          toAuditMetadata(ingestion.summary, ingestion.security, telemetry),
        );

        send({
          type: 'result',
          audit,
          metrics: {
            modelId,
            latencyMs: telemetry.latencyMs,
            inputTokens: telemetry.usage.inputTokens,
            outputTokens: telemetry.usage.outputTokens,
            totalTokens: telemetry.totalTokens,
            costUsd: telemetry.costUsd,
          },
        });
        // ── Persistenza e notifiche ──────────────────────────────────────
        // Dopo il risultato, mai prima: l'utente ha già ciò per cui ha
        // aspettato, e un guasto dell'archivio non deve fargli perdere
        // l'analisi. Per lo stesso motivo niente qui può lanciare.
        send({ type: 'persisted', persistence: await persist(account, audit) });

        send({ type: 'phase', phase: 'done' });
      } catch (error) {
        console.error('[api/audit] audit fallito', error);
        send({
          type: 'error',
          error: 'audit_failed',
          message:
            'L\'audit si è interrotto prima di produrre un risultato conforme allo schema. ' +
            'Riprova, oppure riduci la lunghezza del documento.',
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      // Disattiva il buffering dei proxy: con la risposta bufferizzata gli eventi
      // di avanzamento arriverebbero tutti insieme alla fine, cioè mai.
      'x-accel-buffering': 'no',
    },
  });
}
