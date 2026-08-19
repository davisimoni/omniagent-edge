import { tool } from 'ai';
import { z } from 'zod';
import {
  CONNECTOR_IDS,
  describeCatalog,
  executeConnectorCall,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  type ConnectorCallInput,
  type ConnectorCallResult,
} from '@/lib/agent/connectors';
import type { AgentToolName } from '@/lib/agent/tool-metadata';
import { extractStructured, type ExtractInput, type ExtractOutcome } from '@/lib/ai/extract';
import {
  DEFAULT_TOP_K,
  MAX_TOP_K,
  searchVectorStore,
  type SearchOptions,
  type SearchResponse,
} from '@/lib/vector';

/**
 * I tre tool dell'agente ReAct.
 *
 * Ogni tool è costruito attorno a tre regole:
 *
 * - **Input tipizzato con Zod.** Lo schema diventa il JSON Schema che il modello
 *   vede: le `.describe()` non sono documentazione per noi, sono il contratto che
 *   il modello legge per decidere come chiamare il tool.
 * - **Nessuna eccezione verso il loop.** Un guasto diventa un risultato con
 *   `ok: false` e un messaggio azionabile. Un'eccezione interromperebbe una run
 *   già a metà; un errore descritto permette al modello di correggere e riprovare
 *   allo step successivo, che è esattamente il punto del ciclo ReAct.
 * - **Dipendenze iniettabili.** `createAgentTools()` accetta sostituti per
 *   ricerca, estrazione e connettori: i test verificano gli schemi e la logica di
 *   `execute` senza database, senza rete e senza chiamare il modello.
 */

export interface ToolDependencies {
  readonly search: (query: string, options: SearchOptions) => Promise<SearchResponse>;
  readonly extract: (input: ExtractInput) => Promise<ExtractOutcome>;
  readonly callConnector: (input: ConnectorCallInput) => ConnectorCallResult;
}

export const defaultToolDependencies: ToolDependencies = {
  search: searchVectorStore,
  extract: extractStructured,
  callConnector: executeConnectorCall,
};

export interface ToolContext {
  /** Namespace di ricerca. Deciso dal server, mai dal modello. */
  readonly tenantId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemi di input
// ─────────────────────────────────────────────────────────────────────────────

export const searchVectorDbInput = z.object({
  query: z
    .string()
    .min(3, 'La query deve contenere almeno 3 caratteri.')
    .max(500)
    .describe(
      'Interrogazione in linguaggio naturale. Riformula la domanda dell\'utente con i ' +
        'termini che ti aspetti di trovare nei documenti, non copiarla parola per parola.',
    ),
  topK: z
    .number()
    .int()
    .min(1)
    .max(MAX_TOP_K)
    .default(DEFAULT_TOP_K)
    .describe('Numero di documenti da restituire.'),
  mode: z
    .enum(['hybrid', 'semantic', 'keyword'])
    .default('hybrid')
    .describe(
      'hybrid: fonde ricerca vettoriale e full-text, è la scelta giusta quasi sempre. ' +
        'semantic: solo similarità di significato, per domande concettuali. ' +
        'keyword: solo corrispondenza lessicale, per codici, sigle e nomi esatti.',
    ),
});
export type SearchVectorDbInput = z.infer<typeof searchVectorDbInput>;

export const extractStructuredDataInput = z.object({
  text: z
    .string()
    .min(20, 'Servono almeno 20 caratteri di testo da analizzare.')
    .max(60_000)
    .describe('Il testo grezzo da strutturare.'),
  instructions: z
    .string()
    .max(1_000)
    .optional()
    .describe(
      'Indicazioni sul dominio o sui campi che interessano, es. "è una fattura, ' +
        'servono imponibile e IVA". Omettila se non hai un\'esigenza specifica.',
    ),
});
export type ExtractStructuredDataInput = z.infer<typeof extractStructuredDataInput>;

export const fetchExternalApiInput = z.object({
  connector: z
    .enum(CONNECTOR_IDS)
    .describe('Sistema aziendale da interrogare.'),
  resource: z
    .string()
    .min(1)
    .describe(
      'Risorsa del connettore. Se sbagli il nome, la risposta elenca quelle valide: ' +
        'richiama il tool con una di quelle invece di ipotizzarne un\'altra.',
    ),
  filters: z
    .record(z.string(), z.string())
    .optional()
    .describe(
      'Filtri campo → valore, confrontati per sottostringa senza distinzione di ' +
        'maiuscole. Usa solo i campi elencati per la risorsa.',
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .default(DEFAULT_LIMIT)
    .describe('Numero massimo di record da restituire.'),
});
export type FetchExternalApiInput = z.infer<typeof fetchExternalApiInput>;

// ─────────────────────────────────────────────────────────────────────────────
// Forme di output
// ─────────────────────────────────────────────────────────────────────────────

export interface SearchToolOutput {
  readonly ok: true;
  readonly query: string;
  readonly mode: string;
  readonly backend: string;
  readonly resultCount: number;
  readonly results: readonly {
    readonly rank: number;
    readonly id: string;
    readonly title: string;
    readonly source: string;
    readonly snippet: string;
    readonly score: number;
    readonly matchedIn: readonly string[];
  }[];
  readonly latencyMs: number;
  readonly degraded: boolean;
  readonly note?: string;
}

export interface ExtractToolOutput {
  readonly ok: true;
  readonly extraction: ExtractOutcome['data'];
  readonly latencyMs: number;
  readonly tokensUsed: number;
}

export interface ToolFailure {
  readonly ok: false;
  readonly error: string;
  readonly message: string;
  readonly hint?: readonly string[];
}

function toFailure(error: unknown, fallbackMessage: string): ToolFailure {
  const message = error instanceof Error ? error.message : fallbackMessage;
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'tool_execution_failed';
  return { ok: false, error: code, message };
}

// ─────────────────────────────────────────────────────────────────────────────
// Costruzione
// ─────────────────────────────────────────────────────────────────────────────

export function createAgentTools(
  context: ToolContext = { tenantId: 'public' },
  overrides: Partial<ToolDependencies> = {},
) {
  const deps: ToolDependencies = { ...defaultToolDependencies, ...overrides };

  const searchVectorDB = tool({
    description:
      'Cerca nella base di conoscenza interna dell\'organizzazione (ricerca ibrida: ' +
      'vettoriale su pgvector + full-text, fuse con Reciprocal Rank Fusion). ' +
      'Usalo per qualunque domanda su documenti, procedure, contratti, policy o ' +
      'dati interni. Restituisce estratti con la fonte: cita sempre la fonte quando ' +
      'usi un risultato, e se `degraded` è true dichiara che i dati non provengono ' +
      'da un archivio reale.',
    inputSchema: searchVectorDbInput,
    execute: async ({ query, topK, mode }): Promise<SearchToolOutput | ToolFailure> => {
      try {
        const response = await deps.search(query, { topK, mode, tenantId: context.tenantId });
        return {
          ok: true,
          query,
          mode: response.mode,
          backend: response.backend,
          resultCount: response.hits.length,
          results: response.hits.map((hit) => ({
            rank: hit.rank,
            id: hit.id,
            title: hit.title,
            source: hit.source,
            snippet: hit.snippet,
            score: hit.score,
            matchedIn: hit.matchedIn,
          })),
          latencyMs: response.latencyMs,
          degraded: response.degraded,
          ...(response.note !== undefined ? { note: response.note } : {}),
        };
      } catch (error) {
        return toFailure(error, 'La ricerca nella base di conoscenza non è riuscita.');
      }
    },
  });

  const extractStructuredData = tool({
    description:
      'Trasforma testo non strutturato in JSON validato: tipo di documento, sintesi, ' +
      'entità con citazione a supporto, campi salienti e domande rimaste aperte. ' +
      'Usalo quando l\'utente incolla un documento o quando devi confrontare in modo ' +
      'affidabile dati che nel testo compaiono in forma discorsiva. Ogni entità ' +
      'riporta una citazione letterale: se manca, il dato non era nel testo.',
    inputSchema: extractStructuredDataInput,
    execute: async ({ text, instructions }): Promise<ExtractToolOutput | ToolFailure> => {
      try {
        const outcome = await deps.extract({ text, instructions });
        return {
          ok: true,
          extraction: outcome.data,
          latencyMs: outcome.latencyMs,
          tokensUsed: outcome.usage.inputTokens + outcome.usage.outputTokens,
        };
      } catch (error) {
        return toFailure(error, 'L\'estrazione strutturata non è riuscita.');
      }
    },
  });

  const fetchExternalAPI = tool({
    description:
      'Interroga i sistemi aziendali collegati (CRM, ERP, ticketing) in sola lettura. ' +
      'Usalo per dati operativi e transazionali — clienti, trattative, fatture, ' +
      'giacenze, ticket — che nei documenti non ci sono. I record sono simulati e ' +
      'la risposta lo dichiara con `simulated: true`: riportalo se presenti i dati ' +
      'all\'utente.\n\nCatalogo disponibile:\n' + describeCatalog(),
    inputSchema: fetchExternalApiInput,
    execute: async ({ connector, resource, filters, limit }) => {
      try {
        const result = deps.callConnector({
          connector,
          resource,
          ...(filters !== undefined ? { filters } : {}),
          limit,
        });
        if (!result.ok) {
          return {
            ok: false as const,
            error: result.error,
            message: result.message,
            hint: result.available,
          };
        }
        return result;
      } catch (error) {
        return toFailure(error, 'La chiamata al sistema aziendale non è riuscita.');
      }
    },
  });

  return { searchVectorDB, extractStructuredData, fetchExternalAPI };
}

export type AgentToolSet = ReturnType<typeof createAgentTools>;

/**
 * I nomi dei tool devono restare identici a quelli dichiarati in
 * `tool-metadata.ts`, che la UI importa senza tirarsi dietro questo modulo.
 * L'asserzione fallisce in compilazione se qualcuno aggiunge un tool qui e
 * dimentica l'etichetta là — o viceversa.
 */
type Expect<T extends true> = T;
type _ToolNamesInSync = Expect<
  keyof AgentToolSet extends AgentToolName
    ? AgentToolName extends keyof AgentToolSet
      ? true
      : false
    : false
>;

export { AGENT_TOOL_NAMES, TOOL_LABELS, type AgentToolName } from '@/lib/agent/tool-metadata';
