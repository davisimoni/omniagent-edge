import { generateObject, type ModelMessage } from 'ai';
import { getAgentModel, getAnthropicProviderOptions, getModelId } from '@/lib/ai/model';
import { normalizeUsage, type TokenUsage } from '@/lib/metrics';
import {
  structuredExtractionSchema,
  type Attachment,
  type StructuredExtraction,
} from '@/lib/schemas';

/**
 * Estrattore di dati strutturati.
 *
 * Unico punto in cui si costruisce la chiamata `generateObject`: la usano sia la
 * rotta `/api/extract` sia il tool `extractStructuredData` dell'agente. Se la
 * costruissero separatamente, il tool e l'endpoint darebbero risultati diversi
 * sullo stesso documento, e nessuno saprebbe quale dei due è "quello giusto".
 */

const EXTRACTION_SYSTEM_PROMPT = `Sei un estrattore di dati strutturati. Trasformi un documento in JSON conforme allo schema fornito.

Regole non negoziabili:
1. Estrai solo ciò che il documento afferma. Non dedurre, non completare, non colmare i vuoti con conoscenza generale.
2. Ogni entità deve avere in \`evidence\` una citazione letterale presa dal documento. Se non riesci a citarla parola per parola, non estrarre quell'entità.
3. Quando un'informazione attesa manca, usa \`null\` nei campi che lo ammettono e aggiungi una voce in \`openQuestions\`. Un vuoto dichiarato è utile; un vuoto riempito a caso è un danno.
4. Calibra \`confidence\` sull'evidenza reale: 1.0 solo per un dato citato in modo esplicito e non ambiguo, valori bassi per letture incerte.
5. Normalizza in \`normalized\` solo quando la conversione è certa: date in ISO 8601, importi come numero decimale con punto e senza simbolo di valuta.
6. \`summary\` e i valori testuali restano nella lingua del documento.`;

export interface ExtractInput {
  readonly text?: string | undefined;
  readonly attachment?: Attachment | undefined;
  readonly instructions?: string | undefined;
}

export interface ExtractOutcome {
  readonly data: StructuredExtraction;
  readonly modelId: string;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
  readonly finishReason: string;
}

/** Compone i messaggi: allegato binario come `file` part, testo come `text` part. */
export function buildExtractionMessages(input: ExtractInput): ModelMessage[] {
  const parts: Extract<ModelMessage, { role: 'user' }>['content'] = [];

  if (input.attachment !== undefined) {
    parts.push({
      type: 'file',
      data: input.attachment.data,
      mediaType: input.attachment.mediaType,
      filename: input.attachment.name,
    });
  }

  const preamble =
    input.instructions !== undefined && input.instructions.trim().length > 0
      ? `Istruzioni specifiche per questo documento:\n${input.instructions.trim()}\n\n`
      : '';

  const body =
    input.text !== undefined && input.text.trim().length > 0
      ? `Documento da analizzare:\n\n${input.text.trim()}`
      : 'Analizza il documento allegato.';

  parts.push({ type: 'text', text: `${preamble}${body}` });

  return [{ role: 'user', content: parts }];
}

/**
 * Estrae e valida.
 *
 * `generateObject` valida l'output contro lo schema Zod prima di restituirlo:
 * se il modello produce una forma non conforme, la chiamata fallisce anziché
 * consegnare al chiamante un oggetto che *sembra* tipizzato e non lo è.
 */
export async function extractStructured(input: ExtractInput): Promise<ExtractOutcome> {
  const startedAt = Date.now();
  const modelId = getModelId();

  const result = await generateObject({
    model: getAgentModel(modelId),
    schema: structuredExtractionSchema,
    schemaName: 'StructuredExtraction',
    schemaDescription: 'Rappresentazione strutturata e verificabile del documento fornito.',
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: buildExtractionMessages(input),
    providerOptions: getAnthropicProviderOptions(),
    maxRetries: 2,
  });

  return {
    data: result.object,
    modelId,
    usage: normalizeUsage(result.usage),
    latencyMs: Date.now() - startedAt,
    finishReason: result.finishReason,
  };
}
