import { tool } from 'ai';
import { z } from 'zod';
import {
  extractSlaCommitments,
  runContractAudit,
  type AuditInput,
  type AuditOutcome,
} from '@/lib/audit/engine';
import { buildExecutiveReport, buildExecutiveSummary } from '@/lib/audit/report';
import {
  observedMetricSchema,
  type ContractAudit,
  type ObservedMetric,
  type SlaCommitment,
} from '@/lib/audit/schema';
import { verifySlaCommitments } from '@/lib/audit/sla';
import { searchVectorStore, type SearchOptions, type SearchResponse } from '@/lib/vector';

/**
 * Tool di audit contrattuale per l'agente ReAct.
 *
 * Tre scelte reggono questo modulo:
 *
 * **1. Il registro degli audit vive quanto la richiesta.** `checkContractRisk`
 * conserva l'audit completo in una mappa di closure e ne restituisce l'id;
 * `generateAuditReport` lo recupera da lì. È l'unico modo per non rispedire al
 * modello, a ogni step, un oggetto da decine di migliaia di token che il modello
 * non deve leggere ma solo riferire. Fuori dalla richiesta il registro non
 * esiste, e il tool lo dice con un errore esplicito invece di ri-eseguire in
 * silenzio un audit — che costerebbe un'altra analisi completa e potrebbe
 * restituire rilievi diversi da quelli appena citati all'utente.
 *
 * **2. Nessun numero viene chiesto al modello.** Punteggi, gravità e crediti di
 * servizio escono dalle funzioni pure di `lib/audit/`. Il modello legge il
 * contratto e cita; il resto è aritmetica verificabile.
 *
 * **3. Dipendenze iniettabili.** Come per gli altri tool: i test coprono lo
 * stesso `execute` che gira in produzione, senza rete né modello.
 */

export interface ComplianceToolDependencies {
  readonly audit: (input: AuditInput) => Promise<AuditOutcome>;
  readonly extractCommitments: (text: string) => Promise<{ commitments: SlaCommitment[] }>;
  readonly search: (query: string, options: SearchOptions) => Promise<SearchResponse>;
}

export const defaultComplianceDependencies: ComplianceToolDependencies = {
  audit: runContractAudit,
  extractCommitments: extractSlaCommitments,
  search: searchVectorStore,
};

export interface ComplianceToolContext {
  readonly tenantId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemi di input
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_FOCUS_AREAS = [
  'all',
  'penalties',
  'termination',
  'jurisdiction',
  'gdpr',
  'security',
] as const;
export type RiskFocusArea = (typeof RISK_FOCUS_AREAS)[number];

/** Aree di analisi → clausole del catalogo e categorie di rilievo pertinenti. */
const FOCUS_MAP: Readonly<Record<Exclude<RiskFocusArea, 'all'>, { clauses: readonly string[] }>> = {
  penalties: { clauses: ['penalty_sla_credits', 'liability_cap', 'price_revision', 'indemnity', 'insurance'] },
  termination: {
    clauses: ['termination_convenience', 'termination_cause', 'auto_renewal', 'reversibility'],
  },
  jurisdiction: { clauses: ['jurisdiction_law'] },
  gdpr: {
    clauses: [
      'gdpr_dpa',
      'gdpr_subprocessors',
      'gdpr_data_residency',
      'gdpr_breach_notification',
      'gdpr_audit_rights',
      'gdpr_deletion_return',
    ],
  },
  security: {
    clauses: ['iso27001_certification', 'iso27001_access_control', 'security_incident_response', 'business_continuity'],
  },
};

const FOCUS_CATEGORIES: Readonly<Record<Exclude<RiskFocusArea, 'all'>, readonly string[]>> = {
  penalties: ['financial'],
  termination: ['commercial', 'operational'],
  jurisdiction: ['legal_general'],
  gdpr: ['legal_gdpr'],
  security: ['legal_iso27001', 'security'],
};

export const checkContractRiskInput = z.object({
  text: z
    .string()
    .min(200, 'Servono almeno 200 caratteri: un frammento non permette un audit sensato.')
    .max(300_000)
    .describe('Testo integrale del contratto, SLA o DPA da analizzare.'),
  sourceName: z
    .string()
    .max(255)
    .optional()
    .describe('Nome del documento, usato nel report. Es. "Contratto Acme 2026".'),
  focus: z
    .enum(RISK_FOCUS_AREAS)
    .default('all')
    .describe(
      'all: audit completo su tutte le aree. penalties: penali, massimali e revisione prezzi. ' +
        'termination: recesso, risoluzione, rinnovo tacito e reversibilità. ' +
        'jurisdiction: legge applicabile e foro. gdpr: obblighi ex art. 28 e trasferimenti. ' +
        'security: ISO 27001, incidenti e continuità.',
    ),
  annualValue: z
    .number()
    .positive()
    .optional()
    .describe('Canone annuo in valuta, se noto: serve a monetizzare i crediti di servizio.'),
});

export const verifySlaBreachInput = z.object({
  observedMetrics: z
    .array(observedMetricSchema)
    .min(1, 'Serve almeno una metrica misurata da confrontare.')
    .max(50)
    .describe(
      'Prestazioni realmente misurate. Il nome della metrica deve essere confrontabile con ' +
        'quello usato nel contratto: "uptime_percent" e "Uptime %" vengono allineati automaticamente.',
    ),
  contractText: z
    .string()
    .max(200_000)
    .optional()
    .describe(
      'Testo delle clausole di servizio, se lo hai già. Omettilo per cercarle nella base di conoscenza.',
    ),
  contractQuery: z
    .string()
    .max(300)
    .optional()
    .describe(
      'Che cosa cercare nella base di conoscenza quando `contractText` non è fornito. ' +
        'Es. "SLA disponibilità e tempi di risposta contratto Acme".',
    ),
  annualValue: z
    .number()
    .positive()
    .optional()
    .describe('Canone annuo, per stimare il valore dei crediti di servizio maturati.'),
});

export const generateAuditReportInput = z.object({
  auditId: z
    .string()
    .min(1)
    .describe('Identificativo restituito da `checkContractRisk` nella stessa conversazione.'),
  format: z
    .enum(['executive', 'summary'])
    .default('executive')
    .describe(
      'executive: report completo in Markdown, pronto da inoltrare. ' +
        'summary: solo esito, punteggio e azioni prioritarie.',
    ),
});

// ─────────────────────────────────────────────────────────────────────────────
// Filtro per area di analisi
// ─────────────────────────────────────────────────────────────────────────────

export interface FocusedAudit {
  readonly redFlags: ContractAudit['redFlags'];
  readonly missingClauses: ContractAudit['missingClauses'];
  readonly recommendations: ContractAudit['recommendations'];
}

/**
 * Restringe un audit a un'area di analisi.
 *
 * Il punteggio di rischio **non** viene ricalcolato sul sottoinsieme: resta
 * quello del contratto intero. Un punteggio basso calcolato sulle sole clausole
 * di recesso, in un contratto con una violazione GDPR critica, sarebbe un numero
 * corretto e una risposta fuorviante.
 */
export function focusAudit(audit: ContractAudit, focus: RiskFocusArea): FocusedAudit {
  if (focus === 'all') {
    return {
      redFlags: audit.redFlags,
      missingClauses: audit.missingClauses,
      recommendations: audit.recommendations,
    };
  }

  const clauseIds = new Set(FOCUS_MAP[focus].clauses);
  const categories = new Set<string>(FOCUS_CATEGORIES[focus]);

  const missingClauses = audit.missingClauses.filter((clause) => clauseIds.has(clause.clauseId));
  const redFlags = audit.redFlags.filter((flag) => categories.has(flag.category));
  const keptSourceIds = new Set([
    ...redFlags.map((flag) => flag.id),
    ...missingClauses.map((clause) => `clause-${clause.clauseId}`),
  ]);
  const recommendations = audit.recommendations.filter((recommendation) =>
    recommendation.sourceIds.some((id) => keptSourceIds.has(id)),
  );

  return { redFlags, missingClauses, recommendations };
}

// ─────────────────────────────────────────────────────────────────────────────
// Costruzione dei tool
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolFailure {
  readonly ok: false;
  readonly error: string;
  readonly message: string;
  readonly hint?: readonly string[];
}

function toFailure(error: unknown, fallback: string): ToolFailure {
  const message = error instanceof Error ? error.message : fallback;
  const code =
    error instanceof Error && 'code' in error && typeof error.code === 'string'
      ? error.code
      : 'tool_execution_failed';
  return { ok: false, error: code, message };
}

export function createComplianceTools(
  context: ComplianceToolContext = { tenantId: 'public' },
  overrides: Partial<ComplianceToolDependencies> = {},
) {
  const deps: ComplianceToolDependencies = { ...defaultComplianceDependencies, ...overrides };

  /** Registro di run: vive quanto la richiesta HTTP che ha costruito questi tool. */
  const auditRegistry = new Map<string, ContractAudit>();

  const checkContractRisk = tool({
    description:
      'Sottopone un contratto, uno SLA o un DPA ad audit di conformità: rileva clausole ' +
      'penali, termini di recesso e disdetta, foro competente, lacune GDPR (art. 28, ' +
      'notifica violazioni, trasferimenti extra-UE) e ISO 27001, ciascuna con citazione ' +
      'letterale dal testo. Restituisce un punteggio di rischio 0-100 calcolato in modo ' +
      'deterministico dai rilievi, non stimato dal modello. Conserva l\'audit e ne ' +
      'restituisce l\'`auditId`: passalo a `generateAuditReport` per il report completo, ' +
      'invece di ricomporlo a mano.',
    inputSchema: checkContractRiskInput,
    execute: async ({ text, sourceName, focus, annualValue }) => {
      try {
        const outcome = await deps.audit({
          text,
          sourceName: sourceName ?? 'contratto',
          annualValueOverride: annualValue ?? null,
        });
        const audit = outcome.audit;
        auditRegistry.set(audit.auditId, audit);

        const focused = focusAudit(audit, focus);

        return {
          ok: true as const,
          auditId: audit.auditId,
          focus,
          // Il punteggio è sempre quello dell'intero contratto, anche con un focus attivo.
          riskScore: {
            overall: audit.riskScore.overall,
            band: audit.riskScore.band,
            rationale: audit.riskScore.rationale,
            bandRaisedByCriticalFinding: audit.riskScore.bandRaisedByCriticalFinding,
          },
          keyTerms: {
            documentType: audit.findings.documentType,
            parties: audit.findings.parties,
            governingLaw: audit.findings.governingLaw,
            jurisdiction: audit.findings.jurisdiction,
            effectiveDate: audit.findings.effectiveDate,
            endDate: audit.findings.endDate,
          },
          redFlags: focused.redFlags.map((flag) => ({
            id: flag.id,
            title: flag.title,
            category: flag.category,
            severity: flag.severity,
            finding: flag.finding,
            businessImpact: flag.businessImpact,
            suggestedAction: flag.suggestedAction,
            quote: flag.citation.quote,
            locator: flag.citation.locator,
            citationVerified: flag.citation.verification,
          })),
          missingClauses: focused.missingClauses.map((clause) => ({
            clauseId: clause.clauseId,
            name: clause.name,
            status: clause.status,
            severity: clause.severity,
            reference: clause.reference,
          })),
          slaCommitments: audit.findings.slaCommitments.length,
          // Se ci sono citazioni non ritrovate nel testo, l'agente deve dirlo.
          citationAudit: audit.citationAudit,
          coverage: `${audit.clausesAssessed}/${audit.clausesInCatalog} clausole valutate`,
          disclaimer: audit.disclaimer,
        };
      } catch (error) {
        return toFailure(error, 'L\'audit del contratto non è riuscito.');
      }
    },
  });

  const verifySLABreach = tool({
    description:
      'Confronta prestazioni realmente misurate con gli impegni di livello di servizio ' +
      'scritti nel contratto e stabilisce se c\'è violazione. Le clausole possono essere ' +
      'fornite come testo oppure cercate nella base di conoscenza. Il confronto è ' +
      'aritmetico e non interpretativo; la gravità di uno scostamento su una ' +
      'disponibilità percentuale è misurata sul budget di indisponibilità residuo, non ' +
      'sulla soglia. Riporta anche gli impegni per cui non sono stati forniti dati: ' +
      '"nessuna violazione" e "nessun dato" non sono la stessa cosa.',
    inputSchema: verifySlaBreachInput,
    execute: async ({ observedMetrics, contractText, contractQuery, annualValue }) => {
      try {
        let sourceText = contractText ?? null;
        let sourceOrigin: 'input' | 'vector_store' | 'none' = contractText !== undefined ? 'input' : 'none';
        let retrievedFrom: string[] = [];

        if (sourceText === null) {
          const query = contractQuery ?? 'livelli di servizio SLA disponibilità tempi di risposta penali';
          const response = await deps.search(query, { topK: 5, tenantId: context.tenantId });
          if (response.hits.length === 0) {
            return {
              ok: false as const,
              error: 'no_sla_clauses_found',
              message:
                'Nessuna clausola di livello di servizio trovata nella base di conoscenza. ' +
                'Fornisci il testo contrattuale in `contractText` oppure affina `contractQuery`.',
            };
          }
          sourceText = response.hits.map((hit) => `[${hit.title}]\n${hit.snippet}`).join('\n\n');
          sourceOrigin = 'vector_store';
          retrievedFrom = response.hits.map((hit) => hit.source);
        }

        const { commitments } = await deps.extractCommitments(sourceText);
        if (commitments.length === 0) {
          return {
            ok: false as const,
            error: 'no_commitments_extracted',
            message:
              'Il testo esaminato non contiene impegni di servizio quantificati: non c\'è ' +
              'nulla con cui confrontare le metriche misurate.',
          };
        }

        const result = verifySlaCommitments(commitments, observedMetrics as ObservedMetric[], {
          annualValue: annualValue ?? null,
          sourceText,
        });

        return {
          ok: true as const,
          sourceOrigin,
          retrievedFrom,
          commitmentsFound: commitments.length,
          breachCount: result.violations.length,
          violations: result.violations.map((violation) => ({
            metric: violation.metric,
            description: violation.description,
            committed: `${violation.committed}${violation.unit}`,
            observed: `${violation.observed}${violation.unit}`,
            severity: violation.severity,
            severityBasis: violation.severityBasis,
            period: violation.period,
            penaltyPercent: violation.penaltyPercent,
            estimatedCreditValue: violation.estimatedCreditValue,
            quote: violation.citation?.quote ?? null,
            citationVerified: violation.citation?.verification ?? null,
          })),
          satisfied: result.satisfied,
          // Trasparenza sulla copertura: senza, "nessuna violazione" mentirebbe
          // per omissione quando mancano i dati su metà delle metriche.
          commitmentsWithoutData: result.unverifiedCommitments,
          metricsWithoutCommitment: result.unmatchedMetrics,
        };
      } catch (error) {
        return toFailure(error, 'La verifica degli SLA non è riuscita.');
      }
    },
  });

  const generateAuditReport = tool({
    description:
      'Produce il report esecutivo di un audit già eseguito in questa conversazione: ' +
      'esito e giudizio operativo (firmabile / da negoziare / da non firmare), punteggio ' +
      'per area, azioni prima della firma, rilievi con evidenza, clausole mancanti, SLA ' +
      'disattesi e affidabilità delle citazioni. Richiede l\'`auditId` restituito da ' +
      '`checkContractRisk`.',
    inputSchema: generateAuditReportInput,
    execute: async ({ auditId, format }) => {
      const audit = auditRegistry.get(auditId);
      if (audit === undefined) {
        return {
          ok: false as const,
          error: 'audit_not_found',
          message:
            `Nessun audit con id "${auditId}" in questa conversazione. Il registro vive ` +
            'quanto la richiesta: esegui prima `checkContractRisk` sul documento e usa ' +
            'l\'id che restituisce.',
          hint: [...auditRegistry.keys()],
        };
      }

      const summary = buildExecutiveSummary(audit);
      if (format === 'summary') {
        return { ok: true as const, format, summary };
      }

      return {
        ok: true as const,
        format,
        summary: {
          score: summary.score,
          band: summary.band,
          bandLabel: summary.bandLabel,
          verdict: summary.verdict,
        },
        report: buildExecutiveReport(audit),
      };
    },
  });

  return { checkContractRisk, verifySLABreach, generateAuditReport };
}

export type ComplianceToolSet = ReturnType<typeof createComplianceTools>;
