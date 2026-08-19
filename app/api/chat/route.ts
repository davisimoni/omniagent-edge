import {
  convertToModelMessages,
  safeValidateUIMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';
import { AGENT_SYSTEM_PROMPT } from '@/lib/agent/prompt';
import { createAgentTools } from '@/lib/agent/tools';
import {
  getAgentModel,
  getAnthropicProviderOptions,
  getMaxSteps,
  getModelId,
  hasModelCredentials,
} from '@/lib/ai/model';
import { estimateCostUsd, normalizeUsage } from '@/lib/metrics';
import { chatRequestSchema, type ChatMessageMetadata } from '@/lib/schemas';

/**
 * Agente ReAct in streaming.
 *
 * `runtime = 'edge'` non è una preferenza stilistica: l'agente è I/O-bound —
 * attende il modello, il database e i connettori — e un isolate Edge parte in
 * millisecondi contro le centinaia di un cold start serverless. Ogni dipendenza
 * di questo percorso è stata scelta perché parla `fetch` e non socket TCP.
 *
 * `preferredRegion = 'fra1'` ancora l'esecuzione a Francoforte. Senza questo pin
 * le funzioni girerebbero nella regione di default (`iad1`, Virginia) e ogni
 * query — contenuto dei documenti, record dei clienti — verrebbe elaborata negli
 * Stati Uniti pur avendo il database in UE. È anche la scelta più veloce, perché
 * elimina due traversate atlantiche per round trip.
 */
export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

function jsonError(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();

  // ── Validazione dell'ingresso ────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsedBody = chatRequestSchema.safeParse(rawBody);
  if (!parsedBody.success) {
    return jsonError(400, {
      error: 'invalid_request',
      message: 'Payload non valido.',
      issues: parsedBody.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const validated = await safeValidateUIMessages({ messages: parsedBody.data.messages });
  if (!validated.success) {
    return jsonError(400, {
      error: 'invalid_messages',
      message: 'La cronologia dei messaggi non è nel formato atteso dall\'SDK.',
    });
  }
  const messages: UIMessage[] = validated.data;

  // Fail-closed sulle credenziali: senza chiave si risponde 503 con un messaggio
  // azionabile, invece di lasciare fallire la chiamata a metà stream — a quel
  // punto il client ha già una risposta 200 aperta e l'errore diventa illeggibile.
  if (!hasModelCredentials()) {
    return jsonError(503, {
      error: 'model_unavailable',
      message:
        'ANTHROPIC_API_KEY non è configurata. Copia .env.example in .env.local e ' +
        'inserisci la chiave, oppure impostala fra le Environment Variables su Vercel.',
    });
  }

  // ── Stato della run, catturato dalle callback ────────────────────────────
  const modelId = getModelId();
  // Il tenant lo decide il server. Se lo scegliesse il modello — o il client —
  // un prompt ben congegnato basterebbe a leggere i documenti di un'altra
  // organizzazione. In produzione questo valore arriva dalla sessione.
  const tenantId = parsedBody.data.tenantId ?? 'public';

  let steps = 0;
  let toolCalls = 0;
  let firstTokenAt: number | null = null;

  const result = streamText({
    model: getAgentModel(modelId),
    system: AGENT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    tools: createAgentTools({ tenantId }),
    // Il ciclo ReAct è questo: il modello continua a pianificare, chiamare tool e
    // osservare finché non produce una risposta senza tool call, o finché non
    // esaurisce gli step. Il tetto è la protezione contro un agente in ciclo,
    // che senza limite consumerebbe budget fino al timeout della richiesta.
    stopWhen: stepCountIs(getMaxSteps()),
    providerOptions: getAnthropicProviderOptions(),
    maxRetries: 2,
    onStepEnd: () => {
      steps += 1;
    },
    onChunk: ({ chunk }) => {
      if (firstTokenAt === null && (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')) {
        firstTokenAt = Date.now();
      }
      if (chunk.type === 'tool-call') toolCalls += 1;
    },
  });

  return result.toUIMessageStreamResponse({
    // I blocchi di reasoning sono ciò che la dashboard rende come "Thought": senza
    // questo flag la timeline ReAct mostrerebbe solo azioni e osservazioni, cioè
    // il cosa senza il perché.
    sendReasoning: true,
    messageMetadata: ({ part }): ChatMessageMetadata | undefined => {
      if (part.type === 'start') {
        return { modelId, startedAt };
      }
      if (part.type === 'finish') {
        const usage = normalizeUsage(part.totalUsage);
        const latencyMs = Date.now() - startedAt;
        return {
          modelId,
          latencyMs,
          timeToFirstTokenMs: firstTokenAt === null ? null : firstTokenAt - startedAt,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedInputTokens: usage.cacheReadTokens,
          totalTokens: usage.inputTokens + usage.outputTokens,
          costUsd: estimateCostUsd(usage, modelId),
          steps,
          toolCalls,
          finishReason: part.finishReason,
        };
      }
      return undefined;
    },
    onError: (error) => {
      // Il messaggio grezzo di un provider può contenere frammenti del prompt o
      // dettagli di infrastruttura: resta nei log del server, non nello stream.
      console.error('[api/chat] errore durante lo streaming', error);
      return 'La run dell\'agente si è interrotta. Riprova; se persiste, controlla i log del server.';
    },
  });
}
