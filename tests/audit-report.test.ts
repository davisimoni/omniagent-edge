import { describe, expect, it } from 'vitest';
import { assembleAudit } from '@/lib/audit/engine';
import {
  BAND_VERDICTS,
  buildExecutiveReport,
  buildExecutiveSummary,
  citationReliability,
} from '@/lib/audit/report';
import { auditContext, auditFindings, citation, clauseAssessments, redFlag } from './fixtures/audit';

/**
 * Test del report esecutivo.
 *
 * Il report è il documento che esce dall'azienda: deve dire l'esito, le azioni e
 * — soprattutto — i limiti dell'analisi. Un audit che tace le proprie lacune è
 * peggio di un audit assente, perché nessuno andrà a ricontrollarlo.
 */

const cleanAudit = () =>
  assembleAudit(auditFindings({ redFlags: [], slaCommitments: [] }), auditContext());

const riskyAudit = () =>
  assembleAudit(
    auditFindings({
      clauseAssessments: clauseAssessments('present', {
        gdpr_dpa: 'absent',
        liability_cap: 'partial',
      }),
    }),
    auditContext({ observedMetrics: [{ metric: 'uptime_percent', value: 99.42, period: '2026-07' }] }),
  );

describe('citationReliability', () => {
  it('restituisce la quota di citazioni confermate', () => {
    expect(citationReliability(riskyAudit())).toBeGreaterThan(0);
  });

  it('restituisce null quando non c\'era testo su cui verificare', () => {
    const audit = assembleAudit(auditFindings(), auditContext({ sourceText: null }));
    expect(citationReliability(audit)).toBeNull();
  });
});

describe('buildExecutiveSummary', () => {
  it('accompagna il punteggio con un giudizio operativo', () => {
    const summary = buildExecutiveSummary(riskyAudit());
    expect(summary.verdict).toBe(BAND_VERDICTS[summary.band]);
    expect(summary.verdict.length).toBeGreaterThan(30);
  });

  it('su un contratto pulito non oppone ostacoli alla firma', () => {
    const summary = buildExecutiveSummary(cleanAudit());
    expect(summary.band).toBe('low');
    expect(summary.verdict).toContain('Nessun ostacolo');
  });

  it('elenca solo le azioni di priorità 1 e 2 fra quelle immediate', () => {
    const summary = buildExecutiveSummary(riskyAudit());
    expect(summary.immediateActions.every((action) => action.priority <= 2)).toBe(true);
  });

  it('limita a cinque i rischi principali', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: Array.from({ length: 9 }, (_, index) =>
          redFlag({ title: `Rilievo ${index + 1}` }),
        ),
      }),
      auditContext(),
    );
    expect(buildExecutiveSummary(audit).topRisks).toHaveLength(5);
  });

  it('ordina i rischi principali dal più grave', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: [
          redFlag({ title: 'Lieve', severity: 'low' }),
          redFlag({ title: 'Critico', severity: 'critical' }),
        ],
      }),
      auditContext(),
    );
    expect(buildExecutiveSummary(audit).topRisks[0]?.title).toBe('Critico');
  });

  it('segnala quando la copertura del catalogo è incompleta', () => {
    const partial = clauseAssessments().slice(0, 5);
    const audit = assembleAudit(auditFindings({ clauseAssessments: partial }), auditContext());
    expect(buildExecutiveSummary(audit).coverageComplete).toBe(false);
  });
});

describe('buildExecutiveReport', () => {
  it('apre con esito e punteggio, non con la metodologia', () => {
    const report = buildExecutiveReport(riskyAudit());
    const lines = report.split('\n');
    expect(lines[0]).toContain('# Audit di conformità contrattuale');
    expect(report).toMatch(/\*\*Esito: rischio [A-Z]+ — \d+\/100\*\*/);
  });

  it('è deterministico', () => {
    const audit = riskyAudit();
    expect(buildExecutiveReport(audit)).toBe(buildExecutiveReport(audit));
  });

  it('riporta ogni rilievo con la citazione a supporto', () => {
    const report = buildExecutiveReport(riskyAudit());
    expect(report).toContain('## Rilievi con evidenza');
    expect(report).toContain('3 mensilità del canone');
  });

  it('marca in modo evidente una citazione non ritrovata nel documento', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: [redFlag({ citation: citation('Penale del 50% per ogni disservizio rilevato.') })],
      }),
      auditContext(),
    );
    expect(buildExecutiveReport(audit)).toContain('CITAZIONE NON TROVATA');
  });

  it('elenca le clausole mancanti in tabella', () => {
    const report = buildExecutiveReport(riskyAudit());
    expect(report).toContain('## Clausole assenti o incomplete');
    expect(report).toContain('GDPR art. 28');
  });

  it('riporta gli SLA disattesi con il credito applicabile', () => {
    const report = buildExecutiveReport(riskyAudit());
    expect(report).toContain('## Livelli di servizio disattesi');
    expect(report).toContain('nessuna penale prevista');
  });

  it('chiude sempre con la sezione di affidabilità e con l\'avvertenza', () => {
    const report = buildExecutiveReport(cleanAudit());
    expect(report).toContain('## Affidabilità di questa analisi');
    expect(report.trimEnd().endsWith('_')).toBe(true);
    expect(report).toContain('consulenza legale');
  });

  it('omette le sezioni vuote invece di stamparle senza righe', () => {
    const report = buildExecutiveReport(cleanAudit());
    expect(report).not.toContain('## Rilievi con evidenza');
    expect(report).not.toContain('## Livelli di servizio disattesi');
  });

  it('dichiara la copertura incompleta quando lo è', () => {
    const audit = assembleAudit(
      auditFindings({ clauseAssessments: clauseAssessments().slice(0, 3) }),
      auditContext(),
    );
    expect(buildExecutiveReport(audit)).toContain('Copertura del catalogo incompleta');
  });
});
