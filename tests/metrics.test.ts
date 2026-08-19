import { describe, expect, it } from 'vitest';
import {
  addUsage,
  buildRunMetrics,
  CACHE_READ_MULTIPLIER,
  CACHE_WRITE_MULTIPLIER,
  EMPTY_USAGE,
  estimateCostUsd,
  formatCostUsd,
  formatLatency,
  formatTokens,
  normalizeUsage,
  throughputTokensPerSecond,
  totalTokens,
} from '@/lib/metrics';

describe('normalizeUsage', () => {
  it('restituisce zeri quando l\'usage manca del tutto', () => {
    expect(normalizeUsage(undefined)).toEqual(EMPTY_USAGE);
    expect(normalizeUsage(null)).toEqual(EMPTY_USAGE);
  });

  it('legge i token di cache dai dettagli di input', () => {
    const usage = normalizeUsage({
      inputTokens: 1000,
      outputTokens: 200,
      inputTokenDetails: { cacheReadTokens: 800, cacheWriteTokens: 100 },
    });

    expect(usage.cacheReadTokens).toBe(800);
    expect(usage.cacheWriteTokens).toBe(100);
  });

  it('ricava i token di reasoning anche dai dettagli di output', () => {
    expect(normalizeUsage({ outputTokenDetails: { reasoningTokens: 512 } }).reasoningTokens).toBe(
      512,
    );
  });

  it('azzera valori non finiti o negativi invece di propagare NaN nel costo', () => {
    const usage = normalizeUsage({ inputTokens: Number.NaN, outputTokens: -5 });
    expect(usage.inputTokens).toBe(0);
    expect(usage.outputTokens).toBe(0);
  });
});

describe('addUsage', () => {
  it('somma gli usage dei singoli step di una run multi-step', () => {
    const totale = addUsage(
      { ...EMPTY_USAGE, inputTokens: 100, outputTokens: 50 },
      { ...EMPTY_USAGE, inputTokens: 300, outputTokens: 80, reasoningTokens: 20 },
    );

    expect(totale).toMatchObject({ inputTokens: 400, outputTokens: 130, reasoningTokens: 20 });
  });
});

describe('estimateCostUsd', () => {
  it('calcola il costo con il listino di Claude Opus 5', () => {
    // 1M input a $5 + 1M output a $25.
    const cost = estimateCostUsd(
      { ...EMPTY_USAGE, inputTokens: 1_000_000, outputTokens: 1_000_000 },
      'claude-opus-5',
    );
    expect(cost).toBeCloseTo(30, 6);
  });

  it('applica i moltiplicatori di scrittura e lettura della cache', () => {
    const cost = estimateCostUsd(
      { ...EMPTY_USAGE, cacheReadTokens: 1_000_000, cacheWriteTokens: 1_000_000 },
      'claude-opus-5',
    );
    expect(cost).toBeCloseTo(5 * CACHE_READ_MULTIPLIER + 5 * CACHE_WRITE_MULTIPLIER, 6);
  });

  it('restituisce null per un modello fuori listino', () => {
    // `null` e non `0`: uno zero in dashboard si legge come "gratis".
    expect(estimateCostUsd({ ...EMPTY_USAGE, inputTokens: 1000 }, 'modello-ignoto')).toBeNull();
  });

  it('restituisce zero per una run senza token', () => {
    expect(estimateCostUsd(EMPTY_USAGE, 'claude-opus-5')).toBe(0);
  });
});

describe('totalTokens', () => {
  it('somma input e output senza contare due volte il reasoning', () => {
    const usage = { ...EMPTY_USAGE, inputTokens: 100, outputTokens: 40, reasoningTokens: 30 };
    expect(totalTokens(usage)).toBe(140);
  });
});

describe('buildRunMetrics', () => {
  it('compone la telemetria completa della run', () => {
    const metrics = buildRunMetrics({
      modelId: 'claude-opus-5',
      usage: { ...EMPTY_USAGE, inputTokens: 2_000, outputTokens: 500 },
      latencyMs: 3_200.7,
      timeToFirstTokenMs: 640.2,
      steps: 3,
      toolCalls: 2,
      finishReason: 'stop',
    });

    expect(metrics.latencyMs).toBe(3_201);
    expect(metrics.timeToFirstTokenMs).toBe(640);
    expect(metrics.totalTokens).toBe(2_500);
    expect(metrics.costUsd).toBeGreaterThan(0);
  });

  it('accetta l\'assenza del tempo al primo token', () => {
    const metrics = buildRunMetrics({
      modelId: 'claude-opus-5',
      usage: EMPTY_USAGE,
      latencyMs: 100,
      steps: 1,
      toolCalls: 0,
    });

    expect(metrics.timeToFirstTokenMs).toBeNull();
    expect(metrics.finishReason).toBeNull();
  });
});

describe('throughputTokensPerSecond', () => {
  it('calcola i token di output al secondo', () => {
    expect(throughputTokensPerSecond({ ...EMPTY_USAGE, outputTokens: 500 }, 2_000)).toBe(250);
  });

  it('non riporta un valore su finestre troppo brevi per essere significative', () => {
    expect(throughputTokensPerSecond({ ...EMPTY_USAGE, outputTokens: 10 }, 10)).toBeNull();
    expect(throughputTokensPerSecond(EMPTY_USAGE, 5_000)).toBeNull();
  });
});

describe('formattazione', () => {
  it('mostra i millisecondi sotto il secondo e i secondi oltre', () => {
    expect(formatLatency(420)).toBe('420 ms');
    expect(formatLatency(3_210)).toBe('3.21 s');
  });

  it('distingue costo ignoto da costo nullo', () => {
    expect(formatCostUsd(null)).toBe('n/d');
    expect(formatCostUsd(0)).toBe('$0');
    expect(formatCostUsd(0.000123)).toBe('$0.00012');
  });

  it('abbrevia i conteggi di token oltre il migliaio', () => {
    expect(formatTokens(940)).toBe('940');
    expect(formatTokens(12_400)).toBe('12.4k');
  });
});
