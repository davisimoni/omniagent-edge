import { convertToModelMessages, safeValidateUIMessages, streamText, type UIMessage } from 'ai';
import {
  getAgentModel,
  getAnthropicProviderOptions,
  getModelId,
  hasModelCredentials,
} from '@/lib/ai/model';
import { SUPPORT_SYSTEM_PROMPT } from '@/lib/support/knowledge';
import { supportRequestSchema } from '@/lib/schemas';

/**
 * Assistente di supporto in streaming.
 *
 * **Nessuno strumento, e non è una semplificazione.** L'agente della dashboard
 * ha sei tool; questo non ne ha nessuno. Un widget di aiuto che potesse
 * interrogare il vector store o eseguire un audit sarebbe una seconda porta
 * verso le stesse capacità, con un prompt più corto a difenderla — e la persona
 * che scrive nel riquadro di supporto è chiunque abbia aperto la pagina. Qui si
 * risponde su ciò che il sistema fa, non lo si fa.
 *
 * La cronologia è tagliata lato server: un widget di supporto non ha ragione di
 * accumulare un contesto illimitato, e senza tetto la lunghezza della
 * conversazione diventa la leva con cui si fa salire il costo di ogni richiesta.
 */
export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

/** Turni conservati. Oltre, un widget di aiuto sta facendo altro. */
export const MAX_SUPPORT_MESSAGES = 20;

function jsonError(status: number, body: Record<string, unknown>): Response {
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
    return jsonError(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = supportRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, {
      error: 'invalid_request',
      message: 'Payload non valido.',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const validated = await safeValidateUIMessages({ messages: parsed.data.messages });
  if (!validated.success) {
    return jsonError(400, {
      error: 'invalid_messages',
      message: 'La cronologia non è nel formato atteso dall\'SDK.',
    });
  }

  if (!hasModelCredentials()) {
    return jsonError(503, {
      error: 'model_unavailable',
      message:
        'L\'assistente non è disponibile: ANTHROPIC_API_KEY non è configurata. ' +
        'La piattaforma resta utilizzabile.',
    });
  }

  const messages: UIMessage[] = validated.data.slice(-MAX_SUPPORT_MESSAGES);

  const result = streamText({
    model: getAgentModel(getModelId()),
    system: SUPPORT_SYSTEM_PROMPT,
    messages: await convertToModelMessages(messages),
    providerOptions: getAnthropicProviderOptions(),
    // Un riquadro di supporto largo trecento pixel non è il posto per una
    // dissertazione: il tetto è tarato sulla lunghezza che si legge davvero lì.
    maxOutputTokens: 1_200,
    maxRetries: 2,
  });

  return result.toUIMessageStreamResponse({
    // Il ragionamento non serve: qui interessa la risposta, e mostrarne il
    // percorso in un widget di aiuto aggiunge rumore a chi ha solo una domanda.
    sendReasoning: false,
    onError: (error) => {
      console.error('[api/support] errore durante lo streaming', error);
      return 'L\'assistente si è interrotto. Riprova fra un momento.';
    },
  });
}
