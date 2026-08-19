import { CLAUSE_CATALOG } from '@/lib/audit/clauses';
import type { AuditContext } from '@/lib/audit/engine';
import type {
  AuditFindings,
  Citation,
  ClauseAssessment,
  ClauseStatus,
  RedFlagFinding,
  SlaCommitment,
} from '@/lib/audit/schema';

/**
 * Dati di prova per l'audit.
 *
 * `SOURCE_TEXT` contiene alla lettera tutte le citazioni usate qui sotto: è ciò
 * che permette ai test di distinguere una citazione confermata da una inventata
 * senza dover simulare la verifica.
 */

export const SOURCE_TEXT = `Art. 2 — Durata e rinnovo
Il presente contratto ha durata di 36 mesi. Alla scadenza il contratto si intende tacitamente
rinnovato per ulteriori 36 mesi, salvo disdetta comunicata con almeno 6 mesi di preavviso.

Art. 4 — Livelli di servizio
Il Fornitore garantisce una disponibilità della piattaforma pari al 99,9% su base mensile.
Il mancato raggiungimento dei livelli indicati non dà luogo ad alcun indennizzo.

Art. 7 — Limitazione di responsabilità
La responsabilità complessiva del Fornitore è limitata a un importo pari a 3 mensilità del canone.

Art. 11 — Legge applicabile e foro
Il presente contratto è regolato dalla legge tedesca. Per ogni controversia è competente in via
esclusiva il foro di Amburgo.`;

export function citation(quote: string, locator: string | null = null): Citation {
  return { quote, locator };
}

/** Valutazioni per l'intero catalogo, con lo stato indicato e le eccezioni richieste. */
export function clauseAssessments(
  defaultStatus: ClauseStatus = 'present',
  overrides: Readonly<Record<string, ClauseStatus>> = {},
): ClauseAssessment[] {
  return CLAUSE_CATALOG.map((clause) => {
    const status = overrides[clause.id] ?? defaultStatus;
    return {
      clauseId: clause.id,
      status,
      citation:
        status === 'absent'
          ? null
          : citation('Il presente contratto ha durata di 36 mesi.', 'art. 2'),
      notes: status === 'absent' ? 'Il documento non ne parla.' : '',
    };
  });
}

export function redFlag(overrides: Partial<RedFlagFinding> = {}): RedFlagFinding {
  return {
    title: 'Massimale di responsabilità sproporzionato',
    category: 'financial',
    severity: 'high',
    finding: 'Il massimale è pari a tre mensilità, incapiente rispetto al danno ipotizzabile.',
    citation: citation(
      'La responsabilità complessiva del Fornitore è limitata a un importo pari a 3 mensilità del canone.',
      'art. 7',
    ),
    businessImpact: 'Un incidente sui dati resterebbe a carico del cliente oltre le tre mensilità.',
    suggestedAction: 'Portare il massimale ad almeno il canone annuo ed escludere la colpa grave.',
    ...overrides,
  };
}

export function slaCommitment(overrides: Partial<SlaCommitment> = {}): SlaCommitment {
  return {
    metric: 'uptime_percent',
    description: 'Disponibilità mensile della piattaforma',
    threshold: 99.9,
    unit: '%',
    direction: 'min',
    measurementWindow: 'mensile',
    citation: citation(
      'Il Fornitore garantisce una disponibilità della piattaforma pari al 99,9% su base mensile.',
      'art. 4',
    ),
    penaltyPercent: null,
    ...overrides,
  };
}

export function auditFindings(overrides: Partial<AuditFindings> = {}): AuditFindings {
  return {
    documentType: 'contratto di fornitura',
    title: 'Contratto Nordwind',
    parties: [
      { name: 'Nordwind Cloud Services GmbH', role: 'fornitore' },
      { name: 'Delta Energia S.p.A.', role: 'cliente' },
    ],
    effectiveDate: '2026-03-01',
    endDate: '2029-02-28',
    governingLaw: 'legge tedesca',
    jurisdiction: 'foro di Amburgo',
    annualValue: 240_000,
    currency: 'EUR',
    clauseAssessments: clauseAssessments(),
    redFlags: [redFlag()],
    slaCommitments: [slaCommitment()],
    summary: 'Contratto triennale con rinnovo tacito e massimale di responsabilità ridotto.',
    ...overrides,
  };
}

export function auditContext(overrides: Partial<AuditContext> = {}): AuditContext {
  return {
    auditId: 'audit-test-0001',
    generatedAt: '2026-08-19T10:00:00.000Z',
    sourceName: 'Contratto Nordwind',
    sourceText: SOURCE_TEXT,
    observedMetrics: [],
    annualValueOverride: null,
    ...overrides,
  };
}
