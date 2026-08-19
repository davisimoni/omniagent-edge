import { extractStructured } from '@/lib/ai/extract';
import { hasModelCredentials } from '@/lib/ai/model';
import { estimateCostUsd } from '@/lib/metrics';
import { base64ByteLength, extractRequestSchema, MAX_ATTACHMENT_BYTES } from '@/lib/schemas';

/**
 * Estrazione strutturata sincrona.
 *
 * Non è in streaming di proposito: il consumatore vuole un oggetto JSON validato,
 * e un oggetto parziale in arrivo a pezzi non è utilizzabile finché non è completo.
 * Lo streaming qui aggiungerebbe complessità sul client senza dargli nulla prima.
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
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = extractRequestSchema.safeParse(rawBody);
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

  const { text, attachment, instructions } = parsed.data;

  // Il tetto si verifica sul server anche se il client lo verifica già: un limite
  // applicato solo nel browser è un suggerimento, non un limite.
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

  try {
    const outcome = await extractStructured({ text, attachment, instructions });
    return json(200, {
      ok: true,
      data: outcome.data,
      metrics: {
        modelId: outcome.modelId,
        latencyMs: outcome.latencyMs,
        inputTokens: outcome.usage.inputTokens,
        outputTokens: outcome.usage.outputTokens,
        totalTokens: outcome.usage.inputTokens + outcome.usage.outputTokens,
        costUsd: estimateCostUsd(outcome.usage, outcome.modelId),
        finishReason: outcome.finishReason,
      },
    });
  } catch (error) {
    console.error('[api/extract] estrazione fallita', error);
    // `generateObject` fallisce anche quando il modello produce una forma non
    // conforme allo schema. È il comportamento voluto: meglio un errore esplicito
    // che un oggetto che sembra tipizzato e non lo è.
    return json(502, {
      error: 'extraction_failed',
      message:
        'Il modello non ha prodotto un risultato conforme allo schema. ' +
        'Riprova, oppure riduci la lunghezza del documento.',
    });
  }
}
