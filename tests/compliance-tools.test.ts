import { describe, expect, it, vi } from 'vitest';
import type { ToolExecutionOptions } from 'ai';
import { AGENT_TOOL_NAMES, COMPLIANCE_TOOL_NAMES, isComplianceTool } from '@/lib/agent/tool-metadata';
import { createAgentTools } from '@/lib/agent/tools';
import { assembleAudit, type AuditOutcome } from '@/lib/audit/engine';
import type { ContractAudit } from '@/lib/audit/schema';
import {
  checkContractRiskInput,
  createComplianceTools,
  focusAudit,
  generateAuditReportInput,
  verifySlaBreachInput,
  type ComplianceToolDependencies,
} from '@/lib/tools/compliance-tools';
import { EMPTY_USAGE } from '@/lib/metrics';
import type { SearchResponse } from '@/lib/vector';
import { auditContext, auditFindings, clauseAssessments, redFlag, slaCommitment } from './fixtures/audit';

/**
 * Test dei tool di audit.
 *
 * Nessuna chiamata al modello: `createComplianceTools` accetta dipendenze
 * sostituibili, quindi si verifica lo stesso `execute` che gira in produzione con
 * rilievi fissi. Il punto più importante è il registro di run — `generateAuditReport`
 * deve poter rileggere l'audit prodotto da `checkContractRisk` nella stessa
 * richiesta, e deve fallire in modo esplicito quando non c'è.
 */

const EXEC_OPTIONS = {
  toolCallId: 'test-call',
  messages: [],
} as unknown as ToolExecutionOptions<never>;

const CONTRACT_TEXT = 'Contratto di prova sufficientemente lungo. '.repeat(10);

function auditFixture(overrides: Parameters<typeof auditFindings>[0] = {}): ContractAudit {
  return assembleAudit(auditFindings(overrides), auditContext());
}

function outcome(audit: ContractAudit): AuditOutcome {
  return { audit, modelId: 'claude-opus-5', usage: EMPTY_USAGE, latencyMs: 1_200 };
}

function tools(overrides: Partial<ComplianceToolDependencies> = {}) {
  return createComplianceTools({ tenantId: 'public' }, overrides);
}

// ─────────────────────────────────────────────────────────────────────────────
// Registro
// ─────────────────────────────────────────────────────────────────────────────

describe('registro dei tool di audit', () => {
  it('è incluso nell\'elenco dei tool dell\'agente', () => {
    const all = Object.keys(createAgentTools());
    for (const name of COMPLIANCE_TOOL_NAMES) {
      expect(all).toContain(name);
    }
    expect(Object.keys(createAgentTools()).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it('distingue i tool di audit dagli altri', () => {
    expect(isComplianceTool('checkContractRisk')).toBe(true);
    expect(isComplianceTool('searchVectorDB')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// focusAudit
// ─────────────────────────────────────────────────────────────────────────────

describe('focusAudit', () => {
  const audit = auditFixture({
    clauseAssessments: clauseAssessments('present', {
      gdpr_dpa: 'absent',
      jurisdiction_law: 'absent',
      liability_cap: 'absent',
    }),
    redFlags: [
      redFlag({ title: 'Massimale basso', category: 'financial' }),
      redFlag({ title: 'Foro estero', category: 'legal_general' }),
    ],
  });

  it('con focus "all" non filtra nulla', () => {
    const focused = focusAudit(audit, 'all');
    expect(focused.redFlags).toHaveLength(audit.redFlags.length);
    expect(focused.missingClauses).toHaveLength(audit.missingClauses.length);
  });

  it('restringe alle clausole dell\'area richiesta', () => {
    const focused = focusAudit(audit, 'gdpr');
    expect(focused.missingClauses.map((clause) => clause.clauseId)).toEqual(['gdpr_dpa']);
  });

  it('restringe i rilievi alle categorie dell\'area', () => {
    const focused = focusAudit(audit, 'jurisdiction');
    expect(focused.redFlags.map((flag) => flag.title)).toEqual(['Foro estero']);
  });

  it('tiene solo le raccomandazioni collegate a ciò che resta', () => {
    const focused = focusAudit(audit, 'penalties');
    const keptIds = new Set([
      ...focused.redFlags.map((flag) => flag.id),
      ...focused.missingClauses.map((clause) => `clause-${clause.clauseId}`),
    ]);
    expect(
      focused.recommendations.every((entry) => entry.sourceIds.some((id) => keptIds.has(id))),
    ).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkContractRisk
// ─────────────────────────────────────────────────────────────────────────────

describe('checkContractRisk', () => {
  it('rifiuta un frammento troppo corto per un audit sensato', () => {
    expect(checkContractRiskInput.safeParse({ text: 'due righe' }).success).toBe(false);
  });

  it('applica il focus completo come default', () => {
    const parsed = checkContractRiskInput.parse({ text: CONTRACT_TEXT });
    expect(parsed.focus).toBe('all');
  });

  it('restituisce punteggio, termini chiave e rilievi citati', async () => {
    const audit = vi.fn(async () => outcome(auditFixture()));
    const { checkContractRisk } = tools({ audit });

    const result = await checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: true });
    expect(result).toHaveProperty('riskScore.band');
    expect(result).toHaveProperty('keyTerms.jurisdiction', 'foro di Amburgo');
    expect((result as { redFlags: unknown[] }).redFlags.length).toBeGreaterThan(0);
  });

  it('riporta l\'esito della verifica su ogni citazione', async () => {
    const audit = vi.fn(async () => outcome(auditFixture()));
    const { checkContractRisk } = tools({ audit });

    const result = await checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT }),
      EXEC_OPTIONS,
    );

    const flags = (result as { redFlags: { citationVerified: string }[] }).redFlags;
    expect(flags[0]?.citationVerified).toBe('verified');
    expect(result).toHaveProperty('citationAudit.total');
  });

  it('NON ricalcola il punteggio sul sottoinsieme quando c\'è un focus', async () => {
    // Un punteggio calcolato sulle sole clausole di recesso, in un contratto con
    // una lacuna GDPR critica, sarebbe corretto e fuorviante.
    const full = auditFixture({
      clauseAssessments: clauseAssessments('present', { gdpr_dpa: 'absent' }),
    });
    const { checkContractRisk } = tools({ audit: vi.fn(async () => outcome(full)) });

    const result = await checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT, focus: 'termination' }),
      EXEC_OPTIONS,
    );

    expect(result).toHaveProperty('riskScore.overall', full.riskScore.overall);
    expect(result).toHaveProperty('riskScore.band', 'critical');
  });

  it('inoltra il canone annuo al motore di audit', async () => {
    const audit = vi.fn(async () => outcome(auditFixture()));
    const { checkContractRisk } = tools({ audit });

    await checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT, annualValue: 240_000 }),
      EXEC_OPTIONS,
    );

    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ annualValueOverride: 240_000 }));
  });

  it('trasforma un guasto in un risultato leggibile invece di lanciare', async () => {
    const audit = vi.fn(async () => {
      throw new Error('il modello non ha rispettato lo schema');
    });
    const { checkContractRisk } = tools({ audit });

    const result = await checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: false, message: 'il modello non ha rispettato lo schema' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verifySLABreach
// ─────────────────────────────────────────────────────────────────────────────

describe('verifySLABreach', () => {
  const metrics = [{ metric: 'uptime_percent', value: 99.42, period: '2026-07' }];

  it('pretende almeno una metrica misurata', () => {
    expect(verifySlaBreachInput.safeParse({ observedMetrics: [] }).success).toBe(false);
  });

  it('rileva la violazione dal testo fornito', async () => {
    const extractCommitments = vi.fn(async () => ({ commitments: [slaCommitment()] }));
    const { verifySLABreach } = tools({ extractCommitments });

    const result = await verifySLABreach.execute?.(
      verifySlaBreachInput.parse({ observedMetrics: metrics, contractText: 'clausole SLA' }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: true, sourceOrigin: 'input', breachCount: 1 });
  });

  it('cerca le clausole nel vector store quando il testo non è fornito', async () => {
    const search = vi.fn(
      async (): Promise<SearchResponse> => ({
        hits: [
          {
            id: 'doc-sla',
            title: 'SLA Enterprise',
            snippet: 'Disponibilità garantita 99,9% su base mensile.',
            source: 'contracts/sla.md',
            score: 0.03,
            rank: 1,
            matchedIn: ['semantic'],
          },
        ],
        mode: 'hybrid',
        backend: 'pgvector',
        embeddingBackend: 'remote',
        latencyMs: 30,
        degraded: false,
      }),
    );
    const extractCommitments = vi.fn(async () => ({ commitments: [slaCommitment()] }));
    const { verifySLABreach } = tools({ search, extractCommitments });

    const result = await verifySLABreach.execute?.(
      verifySlaBreachInput.parse({ observedMetrics: metrics, contractQuery: 'SLA disponibilità' }),
      EXEC_OPTIONS,
    );

    expect(search).toHaveBeenCalledWith(
      'SLA disponibilità',
      expect.objectContaining({ tenantId: 'public' }),
    );
    expect(result).toMatchObject({ ok: true, sourceOrigin: 'vector_store' });
    expect(result).toHaveProperty('retrievedFrom', ['contracts/sla.md']);
  });

  it('lo dice quando nella base di conoscenza non c\'è nulla', async () => {
    const search = vi.fn(
      async (): Promise<SearchResponse> => ({
        hits: [],
        mode: 'hybrid',
        backend: 'demo-corpus',
        embeddingBackend: 'deterministic',
        latencyMs: 5,
        degraded: true,
      }),
    );
    const { verifySLABreach } = tools({ search });

    const result = await verifySLABreach.execute?.(
      verifySlaBreachInput.parse({ observedMetrics: metrics }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: false, error: 'no_sla_clauses_found' });
  });

  it('lo dice quando il testo non contiene impegni quantificati', async () => {
    const extractCommitments = vi.fn(async () => ({ commitments: [] }));
    const { verifySLABreach } = tools({ extractCommitments });

    const result = await verifySLABreach.execute?.(
      verifySlaBreachInput.parse({ observedMetrics: metrics, contractText: 'testo senza soglie' }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: false, error: 'no_commitments_extracted' });
  });

  it('distingue "nessuna violazione" da "nessun dato"', async () => {
    const extractCommitments = vi.fn(async () => ({
      commitments: [slaCommitment(), slaCommitment({ metric: 'restore_hours', threshold: 8, unit: 'ore', direction: 'max' })],
    }));
    const { verifySLABreach } = tools({ extractCommitments });

    const result = await verifySLABreach.execute?.(
      verifySlaBreachInput.parse({
        observedMetrics: [{ metric: 'uptime_percent', value: 99.99, period: null }],
        contractText: 'clausole SLA',
      }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: true, breachCount: 0 });
    expect(result).toHaveProperty('commitmentsWithoutData', ['restore_hours']);
  });

  it('stima il credito quando la penale e il canone sono noti', async () => {
    const extractCommitments = vi.fn(async () => ({
      commitments: [slaCommitment({ penaltyPercent: 10 })],
    }));
    const { verifySLABreach } = tools({ extractCommitments });

    const result = await verifySLABreach.execute?.(
      verifySlaBreachInput.parse({
        observedMetrics: metrics,
        contractText: 'clausole SLA',
        annualValue: 240_000,
      }),
      EXEC_OPTIONS,
    );

    const violations = (result as { violations: { estimatedCreditValue: number | null }[] }).violations;
    expect(violations[0]?.estimatedCreditValue).toBe(2_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateAuditReport
// ─────────────────────────────────────────────────────────────────────────────

describe('generateAuditReport', () => {
  it('produce il report esecutivo di un audit eseguito nella stessa run', async () => {
    const audit = auditFixture();
    const toolset = tools({ audit: vi.fn(async () => outcome(audit)) });

    const checked = await toolset.checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT }),
      EXEC_OPTIONS,
    );
    const auditId = (checked as { auditId: string }).auditId;

    const report = await toolset.generateAuditReport.execute?.(
      generateAuditReportInput.parse({ auditId }),
      EXEC_OPTIONS,
    );

    expect(report).toMatchObject({ ok: true, format: 'executive' });
    expect((report as { report: string }).report).toContain('# Audit di conformità contrattuale');
  });

  it('restituisce il solo riepilogo su richiesta', async () => {
    const audit = auditFixture();
    const toolset = tools({ audit: vi.fn(async () => outcome(audit)) });

    const checked = await toolset.checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT }),
      EXEC_OPTIONS,
    );

    const report = await toolset.generateAuditReport.execute?.(
      generateAuditReportInput.parse({
        auditId: (checked as { auditId: string }).auditId,
        format: 'summary',
      }),
      EXEC_OPTIONS,
    );

    expect(report).toMatchObject({ ok: true, format: 'summary' });
    expect(report).not.toHaveProperty('report');
    expect(report).toHaveProperty('summary.verdict');
  });

  it('fallisce in modo esplicito su un id sconosciuto invece di rieseguire l\'audit', async () => {
    const audit = vi.fn(async () => outcome(auditFixture()));
    const { generateAuditReport } = tools({ audit });

    const result = await generateAuditReport.execute?.(
      generateAuditReportInput.parse({ auditId: 'audit-inesistente' }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: false, error: 'audit_not_found' });
    // Rieseguire in silenzio costerebbe un'altra analisi completa e potrebbe
    // restituire rilievi diversi da quelli appena riferiti all'utente.
    expect(audit).not.toHaveBeenCalled();
  });

  it('il registro non è condiviso fra due costruzioni di tool distinte', async () => {
    const audit = auditFixture();
    const first = tools({ audit: vi.fn(async () => outcome(audit)) });
    const second = tools({ audit: vi.fn(async () => outcome(audit)) });

    const checked = await first.checkContractRisk.execute?.(
      checkContractRiskInput.parse({ text: CONTRACT_TEXT }),
      EXEC_OPTIONS,
    );

    const result = await second.generateAuditReport.execute?.(
      generateAuditReportInput.parse({ auditId: (checked as { auditId: string }).auditId }),
      EXEC_OPTIONS,
    );

    expect(result).toMatchObject({ ok: false, error: 'audit_not_found' });
  });
});
