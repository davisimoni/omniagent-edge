import { MODEL_PRICING, type ModelPricing } from '@/lib/ai/model';

/**
 * Contabilità di token, costo e latenza.
 *
 * Modulo puro e senza dipendenze di runtime: la stessa funzione calcola il
 * valore che il server allega alla risposta e quello che la dashboard rende,
 * così i due numeri non possono divergere.
 */

/** Moltiplicatori Anthropic sul prezzo di input per il prompt caching. */
export const CACHE_WRITE_MULTIPLIER = 1.25;
export const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};

/** Forma permissiva dell'usage restituito dall'AI SDK (campi tutti opzionali). */
export interface RawUsageLike {
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  reasoningTokens?: number | undefined;
  inputTokenDetails?:
    | { cacheReadTokens?: number | undefined; cacheWriteTokens?: number | undefined }
    | undefined;
  outputTokenDetails?: { reasoningTokens?: number | undefined } | undefined;
}

function toCount(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * Normalizza l'usage dell'SDK.
 *
 * Ogni campo è opzionale a monte: un provider che non riporta i token di
 * reasoning deve produrre `0`, non `NaN` che si propaga fino al costo mostrato.
 */
export function normalizeUsage(raw: RawUsageLike | undefined | null): TokenUsage {
  if (!raw) return EMPTY_USAGE;
  return {
    inputTokens: toCount(raw.inputTokens),
    outputTokens: toCount(raw.outputTokens),
    reasoningTokens: toCount(raw.reasoningTokens ?? raw.outputTokenDetails?.reasoningTokens),
    cacheReadTokens: toCount(raw.inputTokenDetails?.cacheReadTokens),
    cacheWriteTokens: toCount(raw.inputTokenDetails?.cacheWriteTokens),
  };
}

/** Somma due usage: il loop ReAct produce un usage per step. */
export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

/** Token totali imputati (i token di reasoning sono già inclusi nell'output). */
export function totalTokens(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

/** Listino del modello; `undefined` per un id sconosciuto — meglio nessun costo che uno inventato. */
export function getPricing(modelId: string): ModelPricing | undefined {
  return MODEL_PRICING[modelId];
}

/**
 * Stima il costo in USD.
 *
 * Restituisce `null` — non `0` — quando il listino del modello non è noto:
 * uno zero in dashboard si legge come "gratis", che è la lettura sbagliata.
 */
export function estimateCostUsd(usage: TokenUsage, modelId: string): number | null {
  const pricing = getPricing(modelId);
  if (!pricing) return null;

  const perToken = (perMillion: number): number => perMillion / 1_000_000;
  const cost =
    usage.inputTokens * perToken(pricing.input) +
    usage.outputTokens * perToken(pricing.output) +
    usage.cacheReadTokens * perToken(pricing.input) * CACHE_READ_MULTIPLIER +
    usage.cacheWriteTokens * perToken(pricing.input) * CACHE_WRITE_MULTIPLIER;

  // Arrotondamento al micro-dollaro: sotto questa soglia la cifra è rumore.
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export interface RunMetrics {
  readonly modelId: string;
  readonly usage: TokenUsage;
  readonly totalTokens: number;
  readonly costUsd: number | null;
  readonly latencyMs: number;
  /** Millisecondi fino al primo chunk: è ciò che l'utente percepisce come reattività. */
  readonly timeToFirstTokenMs: number | null;
  readonly steps: number;
  readonly toolCalls: number;
  readonly finishReason: string | null;
}

export function buildRunMetrics(input: {
  modelId: string;
  usage: TokenUsage;
  latencyMs: number;
  timeToFirstTokenMs?: number | null;
  steps: number;
  toolCalls: number;
  finishReason?: string | null;
}): RunMetrics {
  return {
    modelId: input.modelId,
    usage: input.usage,
    totalTokens: totalTokens(input.usage),
    costUsd: estimateCostUsd(input.usage, input.modelId),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
    timeToFirstTokenMs:
      typeof input.timeToFirstTokenMs === 'number'
        ? Math.max(0, Math.round(input.timeToFirstTokenMs))
        : null,
    steps: input.steps,
    toolCalls: input.toolCalls,
    finishReason: input.finishReason ?? null,
  };
}

/** Token di output al secondo; `null` sotto i 50 ms, dove il rapporto è solo rumore. */
export function throughputTokensPerSecond(usage: TokenUsage, latencyMs: number): number | null {
  if (latencyMs < 50 || usage.outputTokens === 0) return null;
  return Math.round((usage.outputTokens / (latencyMs / 1000)) * 10) / 10;
}

export function formatLatency(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatCostUsd(cost: number | null): string {
  if (cost === null) return 'n/d';
  if (cost === 0) return '$0';
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  return `$${cost.toFixed(4)}`;
}

export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  return `${(count / 1000).toFixed(1)}k`;
}
