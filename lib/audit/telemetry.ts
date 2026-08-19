import {
  addUsage,
  EMPTY_USAGE,
  estimateCostUsd,
  totalTokens,
  type TokenUsage,
} from '@/lib/metrics';

/**
 * Contabilità di token e costo per singolo audit.
 *
 * **Perché per fase e non un totale unico.** Un audit su una scansione fa due
 * chiamate al modello: la trascrizione e l'analisi. Sono di natura opposta —
 * la prima produce migliaia di token di output a partire da un'immagine, la
 * seconda ne consuma molti in input — e il loro costo differisce di ordini di
 * grandezza. Chi guarda una fattura mensile e vede solo il totale non ha modo di
 * sapere che a spendere è l'OCR sui PDF scansionati, che è l'unica informazione
 * a partire dalla quale può decidere qualcosa: per esempio chiedere ai fornitori
 * contratti in PDF testuale.
 *
 * Modulo puro. Il costo è una **stima**: il dato fatturato resta quello di
 * Anthropic, e ogni superficie che mostra questi numeri lo dichiara.
 */

export const AUDIT_STAGES = ['ingestion', 'analysis'] as const;
export type AuditStage = (typeof AUDIT_STAGES)[number];

export const STAGE_LABELS: Readonly<Record<AuditStage, string>> = {
  ingestion: 'Lettura del documento',
  analysis: 'Analisi delle clausole',
};

export interface StageInput {
  readonly stage: AuditStage;
  readonly modelId: string | null;
  readonly usage: TokenUsage;
  readonly latencyMs: number;
}

export interface StageCost {
  readonly stage: AuditStage;
  readonly modelId: string | null;
  readonly usage: TokenUsage;
  readonly totalTokens: number;
  /** `null` quando il listino del modello non è noto: meglio nessun numero che uno inventato. */
  readonly costUsd: number | null;
  readonly latencyMs: number;
}

export interface AuditTelemetry {
  readonly stages: readonly StageCost[];
  readonly usage: TokenUsage;
  readonly totalTokens: number;
  readonly costUsd: number | null;
  /**
   * True se il costo copre tutte le fasi che hanno consumato token.
   *
   * Quando è `false` il totale è una sottostima, non un valore incompleto da
   * scartare: dirlo con un flag è più utile che restituire `null` e perdere
   * anche la parte nota.
   */
  readonly costComplete: boolean;
  readonly latencyMs: number;
}

export const EMPTY_TELEMETRY: AuditTelemetry = {
  stages: [],
  usage: EMPTY_USAGE,
  totalTokens: 0,
  costUsd: null,
  costComplete: true,
  latencyMs: 0,
};

function stageConsumedTokens(usage: TokenUsage): boolean {
  return totalTokens(usage) > 0 || usage.cacheReadTokens > 0 || usage.cacheWriteTokens > 0;
}

/**
 * Compone la telemetria di un audit.
 *
 * Le fasi senza consumo vengono scartate: una riga "OCR — 0 token, $0" in un
 * audit su testo incollato descrive qualcosa che non è successo, e chi legge un
 * riepilogo di costi non deve dedurre da uno zero se la fase sia stata gratuita
 * o semplicemente non eseguita.
 */
export function buildAuditTelemetry(
  inputs: readonly StageInput[],
  totalLatencyMs?: number,
): AuditTelemetry {
  const active = inputs.filter((input) => stageConsumedTokens(input.usage));

  const stages: StageCost[] = active.map((input) => ({
    stage: input.stage,
    modelId: input.modelId,
    usage: input.usage,
    totalTokens: totalTokens(input.usage),
    costUsd: input.modelId === null ? null : estimateCostUsd(input.usage, input.modelId),
    latencyMs: Math.max(0, Math.round(input.latencyMs)),
  }));

  const usage = stages.reduce<TokenUsage>((sum, stage) => addUsage(sum, stage.usage), EMPTY_USAGE);
  const known = stages.filter((stage) => stage.costUsd !== null);
  const costComplete = known.length === stages.length;
  const costSum = known.reduce((sum, stage) => sum + (stage.costUsd ?? 0), 0);

  return {
    stages,
    usage,
    totalTokens: totalTokens(usage),
    costUsd: known.length === 0 ? null : Math.round(costSum * 1_000_000) / 1_000_000,
    costComplete,
    latencyMs: Math.max(
      0,
      Math.round(
        totalLatencyMs ?? inputs.reduce((sum, input) => sum + Math.max(0, input.latencyMs), 0),
      ),
    ),
  };
}

/** Costo per mille caratteri analizzati: la misura che permette di confrontare due audit. */
export function costPerThousandCharacters(
  telemetry: AuditTelemetry,
  characters: number,
): number | null {
  if (telemetry.costUsd === null || characters <= 0) return null;
  return Math.round((telemetry.costUsd / (characters / 1000)) * 1_000_000) / 1_000_000;
}
