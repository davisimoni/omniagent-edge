import { describe, expect, it } from 'vitest';
import { assembleAudit, buildAuditContext, buildAuditMessages } from '@/lib/audit/engine';
import { CLAUSE_CATALOG } from '@/lib/audit/clauses';
import { contractAuditSchema, type AuditFindings } from '@/lib/audit/schema';
import {
  auditContext,
  auditFindings,
  citation,
  clauseAssessments,
  redFlag,
  slaCommitment,
  SOURCE_TEXT,
} from './fixtures/audit';

/**
 * Test della composizione dell'audit.
 *
 * `assembleAudit` è pura: prende i rilievi del modello e ne ricava punteggio,
 * clausole mancanti, violazioni e raccomandazioni senza toccare la rete. È il
 * punto in cui si verifica che l'intero verdetto sia riproducibile.
 */

describe('buildAuditMessages', () => {
  it('mette il testo in un messaggio utente', () => {
    const [message] = buildAuditMessages({ text: 'Contratto di prova.' });
    expect(message?.role).toBe('user');
    expect(JSON.stringify(message?.content)).toContain('Contratto di prova.');
  });

  it('antepone l\'allegato al testo, come richiede l\'input multimodale', () => {
    const [message] = buildAuditMessages({
      attachment: { name: 'contratto.pdf', mediaType: 'application/pdf', data: 'JVBERi0=' },
    });
    const content = message?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    expect(content[0]).toMatchObject({ type: 'file', mediaType: 'application/pdf' });
    expect(content[1]).toMatchObject({ type: 'text' });
  });
});

describe('buildAuditContext', () => {
  it('non considera testo sorgente una stringa vuota', () => {
    const context = buildAuditContext({ text: '   ', attachment: undefined });
    expect(context.sourceText).toBeNull();
  });

  it('ricava il nome del documento dall\'allegato quando non è indicato', () => {
    const context = buildAuditContext({
      attachment: { name: 'accordo.pdf', mediaType: 'application/pdf', data: 'x' },
    });
    expect(context.sourceName).toBe('accordo.pdf');
  });

  it('genera un identificativo diverso per ogni audit', () => {
    const first = buildAuditContext({ text: 'testo' });
    const second = buildAuditContext({ text: 'testo' });
    expect(first.auditId).not.toBe(second.auditId);
  });
});

describe('assembleAudit', () => {
  it('produce un oggetto conforme al proprio schema', () => {
    // Lo schema è il contratto dell'esportazione JSON: se l'assemblaggio se ne
    // discosta, il file che l'utente scarica non è più quello documentato.
    const audit = assembleAudit(auditFindings(), auditContext());
    expect(contractAuditSchema.safeParse(audit).success).toBe(true);
  });

  it('è deterministico a parità di rilievi e contesto', () => {
    const findings = auditFindings();
    const context = auditContext();
    expect(assembleAudit(findings, context)).toEqual(assembleAudit(findings, context));
  });

  it('verifica le citazioni dei rilievi contro il testo sorgente', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: [
          redFlag(),
          redFlag({
            title: 'Rilievo inventato',
            citation: citation('Il Fornitore versa una penale del 50% per ogni disservizio.'),
          }),
        ],
      }),
      auditContext(),
    );

    expect(audit.redFlags[0]?.citation.verification).toBe('verified');
    expect(audit.redFlags[1]?.citation.verification).toBe('unverified');
    expect(audit.citationAudit.unverified).toBeGreaterThanOrEqual(1);
  });

  it('marca le citazioni come non verificabili quando manca il testo sorgente', () => {
    const audit = assembleAudit(auditFindings(), auditContext({ sourceText: null }));
    expect(audit.redFlags[0]?.citation.verification).toBe('no-source');
    expect(audit.citationAudit.total).toBe(0);
  });

  it('assegna a ogni rilievo un identificativo stabile e univoco', () => {
    const audit = assembleAudit(
      auditFindings({ redFlags: [redFlag(), redFlag({ title: 'Secondo rilievo' })] }),
      auditContext(),
    );
    const ids = audit.redFlags.map((flag) => flag.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids[0]).toMatch(/^flag-1-/);
  });

  it('ricava le clausole mancanti e le riporta nel conteggio di copertura', () => {
    const audit = assembleAudit(
      auditFindings({
        clauseAssessments: clauseAssessments('present', {
          gdpr_dpa: 'absent',
          gdpr_breach_notification: 'absent',
        }),
      }),
      auditContext(),
    );

    expect(audit.missingClauses.map((clause) => clause.clauseId)).toEqual(
      expect.arrayContaining(['gdpr_dpa', 'gdpr_breach_notification']),
    );
    expect(audit.clausesInCatalog).toBe(CLAUSE_CATALOG.length);
    expect(audit.clausesAssessed).toBe(CLAUSE_CATALOG.length);
  });

  it('porta la fascia a critica quando manca il DPA', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: [],
        clauseAssessments: clauseAssessments('present', { gdpr_dpa: 'absent' }),
      }),
      auditContext(),
    );

    expect(audit.riskScore.band).toBe('critical');
    expect(audit.riskScore.bandRaisedByCriticalFinding).toBe(true);
  });

  it('non verifica gli SLA quando non sono state fornite misure', () => {
    const audit = assembleAudit(auditFindings(), auditContext({ observedMetrics: [] }));
    expect(audit.slaViolations).toEqual([]);
  });

  it('rileva la violazione quando le misure sono fornite', () => {
    const audit = assembleAudit(
      auditFindings(),
      auditContext({ observedMetrics: [{ metric: 'uptime_percent', value: 99.42, period: '2026-07' }] }),
    );

    expect(audit.slaViolations).toHaveLength(1);
    expect(audit.slaViolations[0]?.severity).toBe('critical');
  });

  it('preferisce il canone indicato dall\'utente a quello letto nel contratto', () => {
    const audit = assembleAudit(
      auditFindings({ annualValue: 100_000, slaCommitments: [slaCommitment({ penaltyPercent: 10 })] }),
      auditContext({
        annualValueOverride: 240_000,
        observedMetrics: [{ metric: 'uptime_percent', value: 99, period: null }],
      }),
    );

    expect(audit.slaViolations[0]?.estimatedCreditValue).toBe(2_000);
  });

  it('genera una raccomandazione per ogni problema rilevato', () => {
    const audit = assembleAudit(
      auditFindings({ clauseAssessments: clauseAssessments('present', { liability_cap: 'absent' }) }),
      auditContext({ observedMetrics: [{ metric: 'uptime_percent', value: 99, period: null }] }),
    );

    expect(audit.recommendations.length).toBe(
      audit.redFlags.length + audit.missingClauses.length + audit.slaViolations.length,
    );
    expect(audit.recommendations[0]?.priority).toBeLessThanOrEqual(2);
  });

  it('allega l\'avvertenza a ogni audit', () => {
    const audit = assembleAudit(auditFindings(), auditContext());
    expect(audit.disclaimer).toContain('Non costituisce');
    expect(audit.disclaimer).toContain('consulenza legale');
  });

  it('non lascia rilievi né clausole nel blocco findings: sono campi di primo livello', () => {
    const audit = assembleAudit(auditFindings(), auditContext());
    expect(audit.findings).not.toHaveProperty('redFlags');
    expect(audit.findings).not.toHaveProperty('clauseAssessments');
    expect(audit.findings.documentType).toBe('contratto di fornitura');
  });

  it('regge un contratto senza alcun rilievo', () => {
    const clean: AuditFindings = auditFindings({ redFlags: [], slaCommitments: [] });
    const audit = assembleAudit(clean, auditContext());

    expect(audit.riskScore.overall).toBe(0);
    expect(audit.riskScore.band).toBe('low');
    expect(audit.recommendations).toEqual([]);
    expect(contractAuditSchema.safeParse(audit).success).toBe(true);
  });

  it('registra la lunghezza del testo analizzato', () => {
    const audit = assembleAudit(auditFindings(), auditContext());
    expect(audit.sourceCharacters).toBe(SOURCE_TEXT.length);
  });
});
