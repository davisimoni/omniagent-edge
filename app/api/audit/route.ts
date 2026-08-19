import { hasModelCredentials, getModelId } from '@/lib/ai/model';
import { CLAUSE_CATALOG } from '@/lib/audit/clauses';
import { assembleAudit, buildAuditContext, streamAuditFindings } from '@/lib/audit/engine';
import { auditRequestSchema } from '@/lib/audit/schema';
import type { AuditStreamEvent } from '@/lib/audit/stream';
import { estimateCostUsd, normalizeUsage } from '@/lib/metrics';
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

  const input = {
    text,
    attachment,
    sourceName,
    observedMetrics: observedMetrics ?? [],
    annualValueOverride: annualValueOverride ?? null,
  };
  const context = buildAuditContext(input);
  const modelId = getModelId();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: AuditStreamEvent): void => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        send({ type: 'phase', phase: 'reading' });

        const result = streamAuditFindings(input);
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
        const audit = assembleAudit(findings, context);

        send({ type: 'phase', phase: 'scoring' });
        const usage = normalizeUsage(await result.usage);

        send({
          type: 'result',
          audit,
          metrics: {
            modelId,
            latencyMs: Date.now() - startedAt,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.inputTokens + usage.outputTokens,
            costUsd: estimateCostUsd(usage, modelId),
          },
        });
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
