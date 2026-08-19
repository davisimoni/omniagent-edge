import { z } from 'zod';

/**
 * Schemi Zod condivisi fra tool dell'agente, rotte API e UI.
 *
 * Una sola definizione per ogni forma di dato: lo schema che valida il body di
 * `/api/extract` è lo stesso che tipizza l'input del tool `extractStructuredData`
 * ed è lo stesso da cui il modello riceve il JSON Schema. Duplicarlo significa
 * che prima o poi due copie divergono e la validazione passa su una forma che il
 * modello non produce più.
 *
 * Nota sugli schemi di output: qui si usa sistematicamente `.nullable()` e mai
 * `.optional()`. Con gli structured output un campo opzionale sparisce dalla
 * lista `required` del JSON Schema, e un modello che *non trova* un dato tende
 * a omettere la chiave anziché dichiarare esplicitamente di non averla trovata.
 * `null` è un'informazione; una chiave assente è un'ambiguità.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Estrazione strutturata
// ─────────────────────────────────────────────────────────────────────────────

export const ENTITY_TYPES = [
  'person',
  'organization',
  'location',
  'product',
  'date',
  'monetary_amount',
  'identifier',
  'contact',
  'other',
] as const;

export const entityTypeSchema = z.enum(ENTITY_TYPES);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const extractedEntitySchema = z.object({
  type: entityTypeSchema.describe('Categoria dell\'entità individuata.'),
  value: z.string().min(1).describe('Il valore così come appare nel documento.'),
  normalized: z
    .string()
    .nullable()
    .describe(
      'Forma normalizzata quando esiste: date in ISO 8601 (YYYY-MM-DD), importi come ' +
        'numero decimale puntato senza simbolo di valuta. null se la normalizzazione ' +
        'non si applica o non è ricavabile con certezza.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Quanto è certa l\'estrazione: 1 = citato letteralmente, 0.5 = dedotto.'),
  evidence: z
    .string()
    .min(1)
    .describe(
      'Citazione letterale dal documento che giustifica il valore. Deve comparire ' +
        'nel testo sorgente: se non riesci a citarla, non estrarre l\'entità.',
    ),
});
export type ExtractedEntity = z.infer<typeof extractedEntitySchema>;

export const extractedFieldSchema = z.object({
  key: z.string().min(1).describe('Nome del campo in snake_case.'),
  value: z.string().describe('Valore del campo come stringa; stringa vuota se assente.'),
  confidence: z.number().min(0).max(1),
});
export type ExtractedField = z.infer<typeof extractedFieldSchema>;

export const structuredExtractionSchema = z.object({
  documentType: z
    .string()
    .min(1)
    .describe('Tipo di documento riconosciuto, es. "fattura", "contratto", "email", "sconosciuto".'),
  language: z.string().min(2).describe('Codice ISO 639-1 della lingua prevalente, es. "it".'),
  title: z.string().nullable().describe('Titolo o oggetto del documento; null se non presente.'),
  summary: z.string().min(1).describe('Sintesi in 1-3 frasi, nella lingua del documento.'),
  entities: z.array(extractedEntitySchema).describe('Entità individuate, senza duplicati.'),
  keyFields: z
    .array(extractedFieldSchema)
    .describe('Campi salienti specifici del tipo di documento riconosciuto.'),
  openQuestions: z
    .array(z.string())
    .describe(
      'Informazioni attese per questo tipo di documento ma non determinabili dal testo. ' +
        'Elencarle è preferibile a colmarle con una supposizione.',
    ),
  overallConfidence: z.number().min(0).max(1).describe('Confidenza complessiva sull\'estrazione.'),
});
export type StructuredExtraction = z.infer<typeof structuredExtractionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Payload delle rotte API
// ─────────────────────────────────────────────────────────────────────────────

/** Tetto di dimensione per il testo inviato all'estrattore (~65k token di input). */
export const MAX_EXTRACT_TEXT_LENGTH = 200_000;
/** Tetto di dimensione per gli allegati binari. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * Tipi di file accettati dall'estrattore.
 *
 * SVG è escluso deliberatamente: è un documento eseguibile, e accettarlo da un
 * upload per poi restituirlo sarebbe una XSS servita dalla nostra stessa origine.
 */
export const ACCEPTED_ATTACHMENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
] as const;

/**
 * Dimensione reale di un payload base64, senza decodificarlo.
 *
 * Vive qui accanto al limite che fa rispettare, e non nella rotta: la usano sia
 * `/api/extract` sia `/api/audit`, e una seconda copia sarebbe l'occasione per
 * far divergere due controlli che devono restare identici.
 */
export function base64ByteLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mediaType: z.enum(ACCEPTED_ATTACHMENT_TYPES),
  /** Contenuto in base64, senza prefisso data URI. */
  data: z.string().min(1),
});
export type Attachment = z.infer<typeof attachmentSchema>;

export const extractRequestSchema = z
  .object({
    text: z.string().max(MAX_EXTRACT_TEXT_LENGTH).optional(),
    attachment: attachmentSchema.optional(),
    /** Istruzione libera per orientare l'estrazione su un dominio specifico. */
    instructions: z.string().max(2_000).optional(),
  })
  .refine(
    (value) =>
      (value.text !== undefined && value.text.trim().length > 0) || value.attachment !== undefined,
    { message: 'Fornisci `text` non vuoto oppure `attachment`.' },
  );
export type ExtractRequest = z.infer<typeof extractRequestSchema>;

/**
 * Body di `/api/chat`.
 *
 * Deliberatamente permissivo sulla forma dei messaggi: le `UIMessage` dell'AI SDK
 * hanno una struttura di `parts` ampia e versionata dall'SDK stesso. Qui si
 * verifica ciò che protegge la rotta — presenza, tipo e volume — e si lascia
 * all'SDK la convalida di dettaglio, invece di mantenere una seconda copia del
 * suo schema destinata a divergere.
 */
export const chatRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(100),
  /** Namespace di ricerca, per l'isolamento fra tenant. */
  tenantId: z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export type ChatRequest = z.infer<typeof chatRequestSchema>;

/**
 * Richiesta all'assistente di supporto.
 *
 * Il tetto è a 40 messaggi contro i 100 della chat dell'agente, e non per
 * simmetria: la rotta ne conserva comunque solo gli ultimi venti. Validare più
 * in alto del necessario significherebbe accettare e deserializzare un corpo
 * che verrà scartato subito dopo — lavoro pagato per contenuto che non useremo.
 */
export const supportRequestSchema = z.object({
  messages: z.array(z.unknown()).min(1).max(40),
});
export type SupportRequest = z.infer<typeof supportRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Metadati allegati ai messaggi in streaming
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatMessageMetadata {
  readonly modelId?: string;
  readonly startedAt?: number;
  readonly latencyMs?: number;
  readonly timeToFirstTokenMs?: number | null;
  readonly totalTokens?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly reasoningTokens?: number;
  readonly cachedInputTokens?: number;
  readonly costUsd?: number | null;
  readonly steps?: number;
  readonly toolCalls?: number;
  readonly finishReason?: string | null;
}
