import { describe, expect, it } from 'vitest';
import { CLAUSE_CATALOG, describeClauseCatalog, getClause } from '@/lib/audit/clauses';
import {
  buildRecommendations,
  computeRiskScore,
  deriveMissingClauses,
  PARTIAL_CLAUSE_FACTOR,
  pointsToScore,
  SATURATION_CONSTANT,
  SEVERITY_POINTS,
  toRiskBand,
} from '@/lib/audit/scoring';
import type { MissingClause, RedFlag, SLAViolation } from '@/lib/audit/schema';
import { clauseAssessments } from './fixtures/audit';

/**
 * Test dell'aritmetica dell'audit.
 *
 * È la parte che rende il risultato difendibile: se il punteggio cambia fra due
 * esecuzioni sullo stesso contratto, l'audit non vale niente davanti a un
 * fornitore che lo contesta. Qui si verifica numero per numero.
 */

function flag(overrides: Partial<RedFlag> = {}): RedFlag {
  return {
    id: 'flag-1',
    title: 'Rilievo di prova',
    category: 'financial',
    severity: 'high',
    finding: 'Descrizione del rilievo.',
    citation: { quote: 'citazione', locator: null, verification: 'verified', matchRatio: 1 },
    businessImpact: 'Impatto.',
    suggestedAction: 'Azione.',
    ...overrides,
  };
}

function missing(overrides: Partial<MissingClause> = {}): MissingClause {
  return {
    clauseId: 'liability_cap',
    name: 'Limitazione di responsabilità',
    category: 'financial',
    severity: 'high',
    status: 'absent',
    reference: null,
    whyItMatters: 'Perché conta.',
    notes: '',
    ...overrides,
  };
}

function violation(overrides: Partial<SLAViolation> = {}): SLAViolation {
  return {
    metric: 'uptime_percent',
    description: 'Disponibilità',
    committed: 99.9,
    observed: 99.4,
    unit: '%',
    direction: 'min',
    shortfall: 0.5,
    shortfallRatio: 0.005,
    severityRatio: 5,
    severityBasis: 'error_budget',
    severity: 'critical',
    period: '2026-07',
    penaltyPercent: null,
    estimatedCreditValue: null,
    citation: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Catalogo
// ─────────────────────────────────────────────────────────────────────────────

describe('catalogo delle clausole', () => {
  it('non contiene identificativi duplicati', () => {
    const ids = CLAUSE_CATALOG.map((clause) => clause.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assegna a ogni clausola una gravità e una motivazione', () => {
    for (const clause of CLAUSE_CATALOG) {
      expect(clause.severityIfMissing).toBeTruthy();
      expect(clause.whyItMatters.length).toBeGreaterThan(40);
      expect(clause.lookFor.length).toBeGreaterThan(20);
    }
  });

  it('copre gli obblighi GDPR fondamentali del responsabile', () => {
    const ids = CLAUSE_CATALOG.map((clause) => clause.id);
    expect(ids).toContain('gdpr_dpa');
    expect(ids).toContain('gdpr_breach_notification');
    expect(ids).toContain('gdpr_subprocessors');
  });

  it('classifica come critiche le lacune che espongono a sanzione', () => {
    expect(getClause('gdpr_dpa')?.severityIfMissing).toBe('critical');
    expect(getClause('gdpr_breach_notification')?.severityIfMissing).toBe('critical');
  });

  it('descrive ogni clausola nel testo iniettato nel prompt', () => {
    const description = describeClauseCatalog();
    for (const clause of CLAUSE_CATALOG) {
      expect(description).toContain(clause.id);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Clausole mancanti
// ─────────────────────────────────────────────────────────────────────────────

describe('deriveMissingClauses', () => {
  it('non segnala nulla quando tutte le clausole sono presenti', () => {
    const result = deriveMissingClauses(clauseAssessments('present'));
    expect(result.missing).toEqual([]);
    expect(result.notAssessed).toEqual([]);
    expect(result.assessedCount).toBe(CLAUSE_CATALOG.length);
  });

  it('riporta come mancanti sia le assenti sia le incomplete', () => {
    const result = deriveMissingClauses(
      clauseAssessments('present', { gdpr_dpa: 'absent', liability_cap: 'partial' }),
    );

    expect(result.missing.map((clause) => clause.clauseId).sort()).toEqual([
      'gdpr_dpa',
      'liability_cap',
    ]);
    expect(result.missing.find((clause) => clause.clauseId === 'liability_cap')?.status).toBe(
      'partial',
    );
  });

  it('ordina per gravità decrescente', () => {
    const result = deriveMissingClauses(
      clauseAssessments('present', { insurance: 'absent', gdpr_dpa: 'absent' }),
    );
    expect(result.missing[0]?.clauseId).toBe('gdpr_dpa');
  });

  it('NON considera assente una clausola che il modello non ha valutato', () => {
    // Un rilievo senza evidenza non è un rilievo: finisce nella copertura
    // incompleta, non nell'elenco delle mancanti.
    const partial = clauseAssessments().filter((assessment) => assessment.clauseId !== 'insurance');
    const result = deriveMissingClauses(partial);

    expect(result.missing.map((clause) => clause.clauseId)).not.toContain('insurance');
    expect(result.notAssessed).toEqual(['insurance']);
    expect(result.assessedCount).toBe(CLAUSE_CATALOG.length - 1);
  });

  it('ignora identificativi fuori catalogo senza rompersi', () => {
    const result = deriveMissingClauses([
      ...clauseAssessments(),
      { clauseId: 'clausola_inventata', status: 'absent', citation: null, notes: '' },
    ]);
    expect(result.missing).toEqual([]);
    expect(result.assessedCount).toBe(CLAUSE_CATALOG.length);
  });

  it('a fronte di valutazioni ripetute tiene la più grave', () => {
    const result = deriveMissingClauses([
      { clauseId: 'gdpr_dpa', status: 'present', citation: null, notes: '' },
      { clauseId: 'gdpr_dpa', status: 'absent', citation: null, notes: 'non trovata' },
    ]);
    expect(result.missing.map((clause) => clause.clauseId)).toContain('gdpr_dpa');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Punteggio
// ─────────────────────────────────────────────────────────────────────────────

describe('pointsToScore', () => {
  it('vale zero senza rilievi', () => {
    expect(pointsToScore(0)).toBe(0);
    expect(pointsToScore(-5)).toBe(0);
  });

  it('è monotono crescente', () => {
    expect(pointsToScore(10)).toBeGreaterThan(pointsToScore(5));
    expect(pointsToScore(50)).toBeGreaterThan(pointsToScore(20));
  });

  it('satura sotto 100 anche con moltissimi rilievi', () => {
    expect(pointsToScore(10_000)).toBeLessThanOrEqual(100);
  });

  it('rispetta i punti di riferimento documentati nella tabella', () => {
    expect(pointsToScore(SEVERITY_POINTS.low)).toBe(4);
    expect(pointsToScore(SEVERITY_POINTS.high)).toBe(27);
    expect(pointsToScore(SEVERITY_POINTS.critical)).toBe(55);
    expect(pointsToScore(SEVERITY_POINTS.high * 3)).toBe(62);
  });

  it('raggiunge circa il 63% alla costante di saturazione', () => {
    expect(pointsToScore(SATURATION_CONSTANT)).toBe(63);
  });
});

describe('toRiskBand', () => {
  it('assegna la fascia secondo le soglie', () => {
    expect(toRiskBand(0)).toBe('low');
    expect(toRiskBand(24)).toBe('low');
    expect(toRiskBand(25)).toBe('medium');
    expect(toRiskBand(49)).toBe('medium');
    expect(toRiskBand(50)).toBe('high');
    expect(toRiskBand(74)).toBe('high');
    expect(toRiskBand(75)).toBe('critical');
    expect(toRiskBand(100)).toBe('critical');
  });
});

describe('computeRiskScore', () => {
  const empty = { redFlags: [], missingClauses: [], slaViolations: [] };

  it('vale zero e fascia bassa su un contratto senza rilievi', () => {
    const score = computeRiskScore(empty);
    expect(score.overall).toBe(0);
    expect(score.band).toBe('low');
    expect(score.bandRaisedByCriticalFinding).toBe(false);
    expect(score.rationale).toContain('Nessun rilievo');
  });

  it('è deterministico: gli stessi rilievi danno lo stesso punteggio', () => {
    const input = { ...empty, redFlags: [flag(), flag({ id: 'flag-2', severity: 'medium' })] };
    expect(computeRiskScore(input)).toEqual(computeRiskScore(input));
  });

  it('conta i rilievi per gravità', () => {
    const score = computeRiskScore({
      redFlags: [flag({ severity: 'critical' }), flag({ id: 'f2', severity: 'low' })],
      missingClauses: [missing({ severity: 'medium' })],
      slaViolations: [],
    });

    expect(score.counts).toEqual({ critical: 1, high: 0, medium: 1, low: 1 });
  });

  it('alza la fascia a critica per un solo rilievo critico', () => {
    // 20 punti danno 55/100, cioè fascia "alta" per punteggio. La semantica
    // dell'audit è diversa: una non conformità maggiore non si compensa.
    const score = computeRiskScore({ ...empty, redFlags: [flag({ severity: 'critical' })] });

    expect(score.overall).toBe(55);
    expect(toRiskBand(score.overall)).toBe('high');
    expect(score.band).toBe('critical');
    expect(score.bandRaisedByCriticalFinding).toBe(true);
    expect(score.rationale).toContain('critica');
  });

  it('non segnala l\'innalzamento quando il punteggio è già critico da solo', () => {
    const score = computeRiskScore({
      ...empty,
      redFlags: [
        flag({ id: 'f1', severity: 'critical' }),
        flag({ id: 'f2', severity: 'critical' }),
        flag({ id: 'f3', severity: 'critical' }),
      ],
    });

    expect(score.band).toBe('critical');
    expect(score.bandRaisedByCriticalFinding).toBe(false);
  });

  it('conta una clausola incompleta la metà di una assente', () => {
    const absent = computeRiskScore({ ...empty, missingClauses: [missing({ status: 'absent' })] });
    const partial = computeRiskScore({ ...empty, missingClauses: [missing({ status: 'partial' })] });

    expect(partial.overall).toBe(pointsToScore(SEVERITY_POINTS.high * PARTIAL_CLAUSE_FACTOR));
    expect(partial.overall).toBeLessThan(absent.overall);
  });

  it('attribuisce le violazioni di SLA all\'area operativa, non a quella economica', () => {
    // L'assenza di penali è già contabilizzata come clausola mancante:
    // sommarla anche qui la conterebbe due volte.
    const score = computeRiskScore({ ...empty, slaViolations: [violation()] });

    expect(score.byCategory.operational).toBeGreaterThan(0);
    expect(score.byCategory.financial).toBe(0);
  });

  it('calcola un punteggio per area indipendente dalle altre', () => {
    const score = computeRiskScore({
      ...empty,
      redFlags: [flag({ category: 'legal_gdpr', severity: 'critical' })],
      missingClauses: [missing({ category: 'commercial', severity: 'low' })],
    });

    expect(score.byCategory.legal_gdpr).toBeGreaterThan(score.byCategory.commercial);
    expect(score.byCategory.security).toBe(0);
  });

  it('spiega il punteggio invece di limitarsi al numero', () => {
    const score = computeRiskScore({ ...empty, redFlags: [flag()] });
    expect(score.rationale).toMatch(/\d+\/100/);
    expect(score.rationale).toContain('Economico');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Raccomandazioni
// ─────────────────────────────────────────────────────────────────────────────

describe('buildRecommendations', () => {
  it('genera una raccomandazione per ogni rilievo, clausola e violazione', () => {
    const recommendations = buildRecommendations({
      redFlags: [flag()],
      missingClauses: [missing()],
      slaViolations: [violation()],
    });
    expect(recommendations).toHaveLength(3);
  });

  it('ordina per priorità, dai rilievi critici in giù', () => {
    const recommendations = buildRecommendations({
      redFlags: [flag({ id: 'f1', severity: 'low' }), flag({ id: 'f2', severity: 'critical' })],
      missingClauses: [],
      slaViolations: [],
    });

    expect(recommendations[0]?.priority).toBe(1);
    expect(recommendations[1]?.priority).toBe(4);
  });

  it('collega ogni raccomandazione al rilievo che la giustifica', () => {
    const recommendations = buildRecommendations({
      redFlags: [flag({ id: 'flag-42' })],
      missingClauses: [missing({ clauseId: 'gdpr_dpa' })],
      slaViolations: [],
    });

    expect(recommendations.flatMap((entry) => entry.sourceIds)).toEqual(
      expect.arrayContaining(['flag-42', 'clause-gdpr_dpa']),
    );
  });

  it('distingue "integrare" da "introdurre" secondo lo stato della clausola', () => {
    const [partial] = buildRecommendations({
      redFlags: [],
      missingClauses: [missing({ status: 'partial' })],
      slaViolations: [],
    });
    const [absent] = buildRecommendations({
      redFlags: [],
      missingClauses: [missing({ status: 'absent' })],
      slaViolations: [],
    });

    expect(partial?.title).toContain('Integrare');
    expect(absent?.title).toContain('Introdurre');
  });

  it('chiede il credito quando la penale esiste e lo negozia quando manca', () => {
    const [withPenalty] = buildRecommendations({
      redFlags: [],
      missingClauses: [],
      slaViolations: [violation({ penaltyPercent: 10 })],
    });
    const [withoutPenalty] = buildRecommendations({
      redFlags: [],
      missingClauses: [],
      slaViolations: [violation({ penaltyPercent: null })],
    });

    expect(withPenalty?.action).toContain('10%');
    expect(withPenalty?.effort).toBe('low');
    expect(withoutPenalty?.action).toContain('non prevede alcuna conseguenza economica');
    expect(withoutPenalty?.effort).toBe('high');
  });

  it('non produce identificativi duplicati', () => {
    const recommendations = buildRecommendations({
      redFlags: [flag({ id: 'a' }), flag({ id: 'b' })],
      missingClauses: [missing({ clauseId: 'x' }), missing({ clauseId: 'y' })],
      slaViolations: [],
    });
    const ids = recommendations.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
