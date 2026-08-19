import { describe, expect, it } from 'vitest';
import {
  buildAuditTelemetry,
  costPerThousandCharacters,
  EMPTY_TELEMETRY,
  STAGE_LABELS,
  type StageInput,
} from '@/lib/audit/telemetry';
import { EMPTY_USAGE, estimateCostUsd, type TokenUsage } from '@/lib/metrics';

/**
 * Test della contabilità di token e costo.
 *
 * Il numero mostrato qui finisce in un report che qualcuno userà per decidere se
 * il servizio conviene: deve essere ricostruibile a mano dal listino, e deve
 * dichiararsi incompleto quando lo è, invece di sembrare esatto.
 */

const usage = (inputTokens: number, outputTokens: number): TokenUsage => ({
  ...EMPTY_USAGE,
  inputTokens,
  outputTokens,
});

const stage = (overrides: Partial<StageInput> = {}): StageInput => ({
  stage: 'analysis',
  modelId: 'claude-opus-5',
  usage: usage(20_000, 8_000),
  latencyMs: 12_000,
  ...overrides,
});

describe('buildAuditTelemetry', () => {
  it('somma i token di tutte le fasi', () => {
    const telemetry = buildAuditTelemetry([
      stage({ stage: 'ingestion', usage: usage(4_000, 2_500) }),
      stage({ stage: 'analysis', usage: usage(20_000, 8_000) }),
    ]);

    expect(telemetry.usage.inputTokens).toBe(24_000);
    expect(telemetry.usage.outputTokens).toBe(10_500);
    expect(telemetry.totalTokens).toBe(34_500);
  });

  it('somma i costi delle fasi e coincide con il calcolo dal listino', () => {
    const ingestion = usage(4_000, 2_500);
    const analysis = usage(20_000, 8_000);
    const telemetry = buildAuditTelemetry([
      stage({ stage: 'ingestion', usage: ingestion }),
      stage({ stage: 'analysis', usage: analysis }),
    ]);

    const expected =
      (estimateCostUsd(ingestion, 'claude-opus-5') ?? 0) +
      (estimateCostUsd(analysis, 'claude-opus-5') ?? 0);
    expect(telemetry.costUsd).toBeCloseTo(expected, 6);
    expect(telemetry.costComplete).toBe(true);
  });

  it('separa le fasi invece di restituire un totale unico', () => {
    // È l'unica informazione a partire dalla quale si può decidere qualcosa:
    // per esempio chiedere ai fornitori contratti in PDF testuale.
    const telemetry = buildAuditTelemetry([
      stage({ stage: 'ingestion', usage: usage(4_000, 20_000) }),
      stage({ stage: 'analysis', usage: usage(20_000, 3_000) }),
    ]);

    expect(telemetry.stages).toHaveLength(2);
    expect(telemetry.stages[0]?.stage).toBe('ingestion');
    expect(telemetry.stages[0]?.costUsd).toBeGreaterThan(telemetry.stages[1]?.costUsd ?? 0);
  });

  it('scarta le fasi che non hanno consumato nulla', () => {
    // Una riga "lettura — 0 token, $0" descrive qualcosa che non è successo, e
    // chi legge un riepilogo non deve dedurre da uno zero se la fase sia stata
    // gratuita o semplicemente non eseguita.
    const telemetry = buildAuditTelemetry([
      stage({ stage: 'ingestion', usage: EMPTY_USAGE, modelId: null }),
      stage({ stage: 'analysis' }),
    ]);

    expect(telemetry.stages).toHaveLength(1);
    expect(telemetry.stages[0]?.stage).toBe('analysis');
  });

  it('dichiara il totale incompleto quando un listino non è noto', () => {
    const telemetry = buildAuditTelemetry([
      stage({ stage: 'ingestion', modelId: 'modello-sconosciuto', usage: usage(1_000, 500) }),
      stage({ stage: 'analysis' }),
    ]);

    expect(telemetry.costComplete).toBe(false);
    // Il totale resta utile: è la parte nota, non `null`.
    expect(telemetry.costUsd).toBeGreaterThan(0);
    expect(telemetry.stages[0]?.costUsd).toBeNull();
  });

  it('restituisce null quando nessuna fase ha un listino', () => {
    const telemetry = buildAuditTelemetry([
      stage({ modelId: 'modello-ignoto', usage: usage(1_000, 500) }),
    ]);
    expect(telemetry.costUsd).toBeNull();
  });

  it('preferisce la durata complessiva alla somma delle fasi', () => {
    // Le fasi non coprono l'intera richiesta: parsing, acquisizione e
    // composizione stanno fuori, e sommarle sottostimerebbe l'attesa reale.
    const telemetry = buildAuditTelemetry([stage({ latencyMs: 12_000 })], 19_400);
    expect(telemetry.latencyMs).toBe(19_400);
  });

  it('senza durata complessiva somma quelle delle fasi', () => {
    const telemetry = buildAuditTelemetry([
      stage({ stage: 'ingestion', latencyMs: 5_000 }),
      stage({ stage: 'analysis', latencyMs: 12_000 }),
    ]);
    expect(telemetry.latencyMs).toBe(17_000);
  });

  it('non produce durate negative', () => {
    const telemetry = buildAuditTelemetry([stage({ latencyMs: -50 })]);
    expect(telemetry.latencyMs).toBeGreaterThanOrEqual(0);
    expect(telemetry.stages[0]?.latencyMs).toBe(0);
  });

  it('su nessuna fase restituisce una telemetria vuota e coerente', () => {
    const telemetry = buildAuditTelemetry([]);
    expect(telemetry.stages).toEqual([]);
    expect(telemetry.totalTokens).toBe(0);
    expect(telemetry.costUsd).toBeNull();
    expect(telemetry.usage).toEqual(EMPTY_USAGE);
  });

  it('è deterministico', () => {
    const inputs = [stage({ stage: 'ingestion' }), stage({ stage: 'analysis' })];
    expect(buildAuditTelemetry(inputs, 1_000)).toEqual(buildAuditTelemetry(inputs, 1_000));
  });
});

describe('EMPTY_TELEMETRY', () => {
  it('dichiara di non aver misurato, non di aver misurato zero', () => {
    expect(EMPTY_TELEMETRY.costUsd).toBeNull();
    expect(EMPTY_TELEMETRY.stages).toEqual([]);
  });
});

describe('costPerThousandCharacters', () => {
  it('rapporta il costo alla dimensione del documento', () => {
    const telemetry = buildAuditTelemetry([stage()]);
    const perThousand = costPerThousandCharacters(telemetry, 10_000);
    expect(perThousand).toBeCloseTo((telemetry.costUsd ?? 0) / 10, 6);
  });

  it('restituisce null senza costo noto o senza documento', () => {
    const telemetry = buildAuditTelemetry([stage()]);
    expect(costPerThousandCharacters(telemetry, 0)).toBeNull();
    expect(costPerThousandCharacters(EMPTY_TELEMETRY, 1_000)).toBeNull();
  });
});

describe('STAGE_LABELS', () => {
  it('etichetta ogni fase in italiano', () => {
    expect(STAGE_LABELS.ingestion).toBeTruthy();
    expect(STAGE_LABELS.analysis).toBeTruthy();
  });
});
