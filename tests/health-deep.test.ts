import { describe, expect, it } from 'vitest';
import { overallStatus, SLOW_THRESHOLD_MS, type DependencyCheck } from '@/app/api/health/deep/route';
import { compareVersions, vendorNameFrom } from '@/lib/audits/repository';
import { assembleAudit } from '@/lib/audit/engine';
import { auditContext, auditFindings } from './fixtures/audit';

/**
 * Test della diagnostica profonda e delle proiezioni della cronologia.
 *
 * `overallStatus` è la funzione che decide se far scattare un allarme, e la sua
 * proprietà più importante è quella negativa: una dipendenza **non configurata**
 * non è un guasto. Confondere le due cose farebbe suonare l'allarme su ogni
 * installazione minima, e un allarme che suona sempre viene disattivato.
 */

const check = (overrides: Partial<DependencyCheck> = {}): DependencyCheck => ({
  name: 'postgres',
  status: 'ok',
  latencyMs: 20,
  detail: 'connessione attiva',
  ...overrides,
});

describe('overallStatus', () => {
  it('è "ok" quando tutto risponde', () => {
    expect(overallStatus([check(), check({ name: 'anthropic' })])).toBe('ok');
  });

  it('una dipendenza non configurata NON è un guasto', () => {
    const status = overallStatus([check(), check({ name: 'stripe', status: 'not_configured' })]);
    expect(status).toBe('not_configured');
  });

  it('una dipendenza lenta degrada lo stato complessivo', () => {
    expect(overallStatus([check(), check({ status: 'degraded' })])).toBe('degraded');
  });

  it('una dipendenza giù prevale su tutto il resto', () => {
    expect(
      overallStatus([check(), check({ status: 'degraded' }), check({ status: 'down' })]),
    ).toBe('down');
  });

  it('su un elenco vuoto non inventa un guasto', () => {
    expect(overallStatus([])).toBe('ok');
  });

  it('la soglia di lentezza è dichiarata e ragionevole', () => {
    expect(SLOW_THRESHOLD_MS).toBeGreaterThan(500);
    expect(SLOW_THRESHOLD_MS).toBeLessThanOrEqual(5_000);
  });
});

describe('vendorNameFrom', () => {
  it('riconosce il fornitore fra le parti del contratto', () => {
    const audit = assembleAudit(auditFindings(), auditContext());
    expect(vendorNameFrom(audit)).toBe('Nordwind Cloud Services GmbH');
  });

  it('ripiega sulla prima parte quando nessun ruolo dice "fornitore"', () => {
    const audit = assembleAudit(
      auditFindings({ parties: [{ name: 'Alfa SpA', role: 'parte' }] }),
      auditContext(),
    );
    expect(vendorNameFrom(audit)).toBe('Alfa SpA');
  });

  it('restituisce null quando non ci sono parti', () => {
    const audit = assembleAudit(auditFindings({ parties: [] }), auditContext());
    expect(vendorNameFrom(audit)).toBeNull();
  });
});

describe('compareVersions', () => {
  const base = { riskScore: 70, riskBand: 'high' as const, redFlagCount: 5, missingClauseCount: 4 };

  it('un punteggio che SCENDE è un miglioramento: misura il rischio', () => {
    // Invertirlo produrrebbe una freccia verde su un contratto peggiorato, che è
    // il modo più efficace di far firmare la revisione sbagliata.
    const delta = compareVersions(base, { ...base, riskScore: 45, riskBand: 'medium' });
    expect(delta.direction).toBe('improved');
    expect(delta.scoreDelta).toBe(-25);
    expect(delta.bandChanged).toBe(true);
  });

  it('un punteggio che sale è un peggioramento', () => {
    expect(compareVersions(base, { ...base, riskScore: 85 }).direction).toBe('worsened');
  });

  it('a parità di punteggio non segnala variazioni', () => {
    const delta = compareVersions(base, base);
    expect(delta.direction).toBe('unchanged');
    expect(delta.scoreDelta).toBe(0);
    expect(delta.bandChanged).toBe(false);
  });

  it('riporta anche le variazioni di rilievi e clausole', () => {
    const delta = compareVersions(base, { ...base, redFlagCount: 2, missingClauseCount: 6 });
    expect(delta.redFlagDelta).toBe(-3);
    expect(delta.missingClauseDelta).toBe(2);
  });
});
