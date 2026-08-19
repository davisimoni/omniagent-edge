import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { readEnv, readEnvInt } from '@/lib/env';

/**
 * Modello di default dell'agente.
 *
 * Nota API: sulla famiglia Opus 5 i parametri di sampling (`temperature`,
 * `topP`, `topK`) e `budgetTokens` sono stati rimossi e restituiscono 400.
 * La profondità di ragionamento si governa con `effort` + thinking adattivo,
 * non con la temperatura: per questo `streamText` qui non passa mai `temperature`.
 */
export const DEFAULT_MODEL_ID = 'claude-opus-5';

export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const EFFORT_LEVELS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export interface ModelPricing {
  /** USD per 1M token di input. */
  readonly input: number;
  /** USD per 1M token di output. */
  readonly output: number;
}

/**
 * Listino Anthropic (USD / 1M token), aggiornato al 2026-06.
 * Serve solo alla stima di costo mostrata in dashboard: il dato fatturato
 * resta quello di Anthropic, e la UI lo dichiara come stima.
 */
export const MODEL_PRICING: Readonly<Record<string, ModelPricing>> = {
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'claude-fable-5': { input: 10, output: 50 },
};

/** Id del modello effettivamente in uso (override via `OMNIAGENT_MODEL`). */
export function getModelId(): string {
  return readEnv('OMNIAGENT_MODEL') ?? DEFAULT_MODEL_ID;
}

/** Livello di effort dell'agente; valori ignoti ripiegano su `high`. */
export function getEffort(): EffortLevel {
  const raw = readEnv('OMNIAGENT_EFFORT');
  const match = EFFORT_LEVELS.find((level) => level === raw);
  return match ?? 'high';
}

/** Tetto di step del loop ReAct: impedisce a un agente in ciclo di bruciare budget. */
export function getMaxSteps(): number {
  return readEnvInt('OMNIAGENT_MAX_STEPS', 8, 1, 20);
}

export class MissingModelCredentialsError extends Error {
  readonly code = 'missing_model_credentials';
  constructor() {
    super(
      'ANTHROPIC_API_KEY non è configurata. Copia .env.example in .env.local e ' +
        'inserisci la chiave, oppure impostala nelle Environment Variables del progetto Vercel.',
    );
    this.name = 'MissingModelCredentialsError';
  }
}

/** True se il modello è configurabile: usata dalle rotte per un 503 parlante. */
export function hasModelCredentials(): boolean {
  return readEnv('ANTHROPIC_API_KEY') !== undefined;
}

/**
 * Costruisce il language model.
 *
 * Il client è creato per invocazione anziché a livello di modulo: su Edge il
 * modulo è valutato al primo import e una chiave letta allora resterebbe
 * congelata per tutta la vita dell'isolate.
 */
export function getAgentModel(modelId: string = getModelId()): LanguageModel {
  const apiKey = readEnv('ANTHROPIC_API_KEY');
  if (apiKey === undefined) throw new MissingModelCredentialsError();

  const anthropic = createAnthropic({ apiKey });
  return anthropic(modelId);
}

/**
 * Opzioni provider condivise da tutte le chiamate.
 *
 * `thinking.display: 'summarized'` è esplicito e non un default: su Opus 5 il
 * default è `omitted`, e senza questa riga la dashboard mostrerebbe una lunga
 * pausa vuota al posto dello step "Thought" del ciclo ReAct.
 */
export function getAnthropicProviderOptions() {
  // Il tipo è inferito di proposito: `ProviderOptions` non è ri-esportato da `ai`,
  // e annotarlo costringerebbe a dipendere direttamente da un pacchetto che oggi
  // è solo transitivo.
  return {
    anthropic: {
      thinking: { type: 'adaptive', display: 'summarized' },
      effort: getEffort(),
    },
  };
}
