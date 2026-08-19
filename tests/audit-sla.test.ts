import { describe, expect, it } from 'vitest';
import {
  evaluateSlaBreach,
  normalizeMetricName,
  severityBasisFor,
  severityFromRatio,
  verifySlaCommitments,
} from '@/lib/audit/sla';
import { slaCommitment, SOURCE_TEXT } from './fixtures/audit';

/**
 * Test della verifica degli SLA.
 *
 * Dichiarare una violazione ha una conseguenza economica: si richiede un credito,
 * si contesta una fattura. Il confronto deve quindi essere aritmetico e
 * riproducibile, e questi test lo fissano caso per caso.
 */

describe('normalizeMetricName', () => {
  it('allinea le convenzioni di scrittura fra contratto e monitoraggio', () => {
    expect(normalizeMetricName('Uptime %')).toBe('uptime');
    expect(normalizeMetricName('uptime_percent')).toBe('uptime_percent');
    expect(normalizeMetricName('First Response (minuti)')).toBe('first_response_minuti');
  });

  it('rimuove i diacritici', () => {
    expect(normalizeMetricName('Disponibilità')).toBe('disponibilita');
  });
});

describe('severityFromRatio', () => {
  it('cresce con lo scostamento', () => {
    expect(severityFromRatio(0.1)).toBe('low');
    expect(severityFromRatio(0.5)).toBe('medium');
    expect(severityFromRatio(1.5)).toBe('high');
    expect(severityFromRatio(4)).toBe('critical');
  });
});

describe('severityBasisFor', () => {
  it('misura una disponibilità percentuale sul budget di indisponibilità residuo', () => {
    // Impegno 99,9% → budget 0,1%. Uno scostamento di 0,4 punti ne consuma
    // quattro volte tanto: circa tre ore di fermo al mese contro quarantatré minuti.
    const result = severityBasisFor({ threshold: 99.9, unit: '%', direction: 'min' }, 0.4);
    expect(result.basis).toBe('error_budget');
    expect(result.ratio).toBeCloseTo(4, 6);
  });

  it('usa la soglia per le metriche non percentuali', () => {
    const result = severityBasisFor({ threshold: 60, unit: 'minuti', direction: 'max' }, 180);
    expect(result.basis).toBe('threshold');
    expect(result.ratio).toBeCloseTo(3, 6);
  });

  it('usa la soglia anche per una percentuale con direzione "al massimo"', () => {
    const result = severityBasisFor({ threshold: 2, unit: '%', direction: 'max' }, 1);
    expect(result.basis).toBe('threshold');
  });

  it('tratta come totale qualunque scostamento da una soglia zero', () => {
    const result = severityBasisFor({ threshold: 0, unit: 'incidenti', direction: 'max' }, 3);
    expect(result.ratio).toBe(Number.POSITIVE_INFINITY);
    expect(severityFromRatio(result.ratio)).toBe('critical');
  });
});

describe('evaluateSlaBreach', () => {
  const uptime = slaCommitment();

  it('non segnala nulla quando l\'impegno è rispettato', () => {
    expect(
      evaluateSlaBreach(uptime, { metric: 'uptime_percent', value: 99.95, period: '2026-07' }),
    ).toBeNull();
  });

  it('non segnala nulla quando il valore coincide con la soglia', () => {
    expect(
      evaluateSlaBreach(uptime, { metric: 'uptime_percent', value: 99.9, period: null }),
    ).toBeNull();
  });

  it('tollera l\'errore in virgola mobile invece di aprire contestazioni infondate', () => {
    const almostExact = 99.9 - 1e-12;
    expect(
      evaluateSlaBreach(uptime, { metric: 'uptime_percent', value: almostExact, period: null }),
    ).toBeNull();
  });

  it('rileva la violazione di una soglia minima', () => {
    const result = evaluateSlaBreach(uptime, {
      metric: 'uptime_percent',
      value: 99.42,
      period: '2026-07',
    });

    expect(result).not.toBeNull();
    expect(result?.observed).toBe(99.42);
    expect(result?.committed).toBe(99.9);
    expect(result?.severityBasis).toBe('error_budget');
    // 0,48 punti su 0,1 di budget: quasi cinque volte il consentito.
    expect(result?.severity).toBe('critical');
  });

  it('rileva la violazione di una soglia massima', () => {
    const responseTime = slaCommitment({
      metric: 'first_response_minutes',
      description: 'Tempo di presa in carico severità 1',
      threshold: 60,
      unit: 'minuti',
      direction: 'max',
    });

    const result = evaluateSlaBreach(responseTime, {
      metric: 'first_response_minutes',
      value: 96,
      period: '2026-07',
    });

    expect(result?.shortfall).toBe(36);
    expect(result?.severity).toBe('medium');
  });

  it('classifica come lieve uno sforamento marginale della disponibilità', () => {
    const result = evaluateSlaBreach(uptime, {
      metric: 'uptime_percent',
      value: 99.88,
      period: null,
    });
    expect(result?.severity).toBe('low');
  });

  it('monetizza il credito sul canone del periodo, non sull\'annuo', () => {
    const withPenalty = slaCommitment({ penaltyPercent: 10 });
    const result = evaluateSlaBreach(
      withPenalty,
      { metric: 'uptime_percent', value: 99, period: '2026-07' },
      { annualValue: 240_000 },
    );

    // 240.000 / 12 = 20.000 al mese; il 10% è 2.000.
    expect(result?.estimatedCreditValue).toBe(2_000);
  });

  it('non stima alcun credito quando il contratto non prevede penali', () => {
    const result = evaluateSlaBreach(
      uptime,
      { metric: 'uptime_percent', value: 99, period: null },
      { annualValue: 240_000 },
    );
    expect(result?.estimatedCreditValue).toBeNull();
    expect(result?.penaltyPercent).toBeNull();
  });

  it('non stima alcun credito senza canone noto', () => {
    const result = evaluateSlaBreach(slaCommitment({ penaltyPercent: 10 }), {
      metric: 'uptime_percent',
      value: 99,
      period: null,
    });
    expect(result?.estimatedCreditValue).toBeNull();
  });

  it('verifica la citazione della clausola contro il testo sorgente', () => {
    const result = evaluateSlaBreach(
      uptime,
      { metric: 'uptime_percent', value: 99, period: null },
      { sourceText: SOURCE_TEXT },
    );
    expect(result?.citation?.verification).toBe('verified');
  });
});

describe('verifySlaCommitments', () => {
  const commitments = [
    slaCommitment(),
    slaCommitment({
      metric: 'first_response_minutes',
      description: 'Presa in carico severità 1',
      threshold: 60,
      unit: 'minuti',
      direction: 'max',
    }),
    slaCommitment({
      metric: 'restore_hours',
      description: 'Ripristino severità 1',
      threshold: 8,
      unit: 'ore',
      direction: 'max',
    }),
  ];

  it('separa violazioni e impegni rispettati', () => {
    const result = verifySlaCommitments(commitments, [
      { metric: 'uptime_percent', value: 99.42, period: '2026-07' },
      { metric: 'first_response_minutes', value: 96, period: '2026-07' },
      { metric: 'restore_hours', value: 7.5, period: '2026-07' },
    ]);

    expect(result.violations.map((entry) => entry.metric).sort()).toEqual([
      'first_response_minutes',
      'uptime_percent',
    ]);
    expect(result.satisfied.map((entry) => entry.metric)).toEqual(['restore_hours']);
  });

  it('ordina le violazioni dalla più grave', () => {
    const result = verifySlaCommitments(commitments, [
      { metric: 'uptime_percent', value: 99.42, period: null },
      { metric: 'first_response_minutes', value: 70, period: null },
    ]);
    expect(result.violations[0]?.metric).toBe('uptime_percent');
  });

  it('riporta gli impegni per cui non sono stati forniti dati', () => {
    // "Nessuna violazione" e "nessun dato" non sono la stessa cosa: tacerlo
    // significherebbe comunicare una falsità con parole vere.
    const result = verifySlaCommitments(commitments, [
      { metric: 'uptime_percent', value: 99.95, period: null },
    ]);

    expect(result.violations).toEqual([]);
    expect([...result.unverifiedCommitments].sort()).toEqual([
      'first_response_minutes',
      'restore_hours',
    ]);
  });

  it('riporta le metriche fornite che non corrispondono a nessun impegno', () => {
    const result = verifySlaCommitments(commitments, [
      { metric: 'throughput_rps', value: 120, period: null },
    ]);
    expect(result.unmatchedMetrics).toEqual(['throughput_rps']);
  });

  it('allinea nomi scritti in modo diverso fra contratto e monitoraggio', () => {
    const result = verifySlaCommitments([slaCommitment({ metric: 'Uptime %' })], [
      { metric: 'uptime %', value: 99.1, period: null },
    ]);
    expect(result.violations).toHaveLength(1);
  });

  it('senza impegni non produce né violazioni né metriche orfane fantasma', () => {
    const result = verifySlaCommitments([], [{ metric: 'uptime_percent', value: 99, period: null }]);
    expect(result.violations).toEqual([]);
    expect(result.unmatchedMetrics).toEqual(['uptime_percent']);
  });
});
