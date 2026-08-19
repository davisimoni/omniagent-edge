import { z } from 'zod';

/**
 * Contratti dati del motore di audit.
 *
 * Il file è diviso in due metà, e la divisione è la decisione architetturale più
 * importante di tutto il modulo:
 *
 * **Sopra — ciò che produce il modello.** Solo osservazioni ancorate al testo:
 * quali clausole ha trovato, cosa cita, quali impegni di livello di servizio
 * sono scritti nel contratto. Compiti di riconoscimento, tutti verificabili
 * contro il documento.
 *
 * **Sotto — ciò che calcoliamo noi.** Punteggio di rischio, clausole mancanti,
 * violazioni di SLA, raccomandazioni. Nessuno di questi valori è chiesto al
 * modello.
 *
 * Il motivo è che un audit deve essere difendibile. Un punteggio "72/100"
 * prodotto da un modello non è riproducibile, non si può spiegare a un
 * responsabile acquisti e cambia fra due esecuzioni sullo stesso PDF. Lo stesso
 * punteggio calcolato da una funzione pura a partire da rilievi citati si
 * ricostruisce riga per riga, si testa, e resta identico a parità di input.
 * Il modello trova le prove; l'aritmetica è nostra.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Vocabolari
// ─────────────────────────────────────────────────────────────────────────────

export const RISK_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const riskSeveritySchema = z.enum(RISK_SEVERITIES);
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

export const RISK_CATEGORIES = [
  'financial',
  'legal_gdpr',
  'legal_iso27001',
  'legal_general',
  'security',
  'operational',
  'commercial',
] as const;
export const riskCategorySchema = z.enum(RISK_CATEGORIES);
export type RiskCategory = (typeof RISK_CATEGORIES)[number];

export const RISK_BANDS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/** Etichette leggibili, condivise fra report ed interfaccia. */
export const CATEGORY_LABELS: Readonly<Record<RiskCategory, string>> = {
  financial: 'Economico',
  legal_gdpr: 'GDPR',
  legal_iso27001: 'ISO 27001',
  legal_general: 'Legale',
  security: 'Sicurezza',
  operational: 'Operativo',
  commercial: 'Commerciale',
};

export const SEVERITY_LABELS: Readonly<Record<RiskSeverity, string>> = {
  low: 'Basso',
  medium: 'Medio',
  high: 'Alto',
  critical: 'Critico',
};

// ─────────────────────────────────────────────────────────────────────────────
// Ciò che produce il modello
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Citazione dal documento.
 *
 * `quote` deve essere testo **letterale**, non parafrasato: è la sola cosa che
 * rende un rilievo verificabile, ed è ciò che `verifyCitations()` ricerca nel
 * sorgente per marcare la citazione come confermata o inventata.
 */
export const citationSchema = z.object({
  quote: z
    .string()
    .min(12, 'Una citazione troppo breve non è verificabile.')
    .max(1_200)
    .describe(
      'Estratto LETTERALE dal documento, copiato parola per parola. Non riformulare, ' +
        'non correggere refusi, non tradurre. Se non riesci a copiare il testo esatto, ' +
        'non riportare il rilievo.',
    ),
  locator: z
    .string()
    .nullable()
    .describe('Dove si trova, se ricavabile: "art. 7.2", "pag. 4", "Allegato B". null altrimenti.'),
});
export type Citation = z.infer<typeof citationSchema>;

export const CLAUSE_STATUSES = ['present', 'partial', 'absent'] as const;
export const clauseStatusSchema = z.enum(CLAUSE_STATUSES);
export type ClauseStatus = (typeof CLAUSE_STATUSES)[number];

export const clauseAssessmentSchema = z.object({
  clauseId: z.string().min(1).describe('Identificativo preso dal catalogo fornito.'),
  status: clauseStatusSchema.describe(
    'present: la clausola c\'è ed è completa. partial: il tema è toccato ma manca un ' +
      'elemento essenziale (per esempio un termine, un massimale o un obbligo). ' +
      'absent: il documento non ne parla.',
  ),
  citation: citationSchema
    .nullable()
    .describe('Obbligatoria se status è present o partial; null se absent.'),
  notes: z
    .string()
    .describe('Una frase su cosa è presente o cosa manca. Stringa vuota se non serve.'),
});
export type ClauseAssessment = z.infer<typeof clauseAssessmentSchema>;

export const redFlagSchema = z.object({
  title: z.string().min(3).max(120).describe('Titolo breve del rilievo.'),
  category: riskCategorySchema,
  severity: riskSeveritySchema.describe(
    'critical: espone a sanzione, blocco del servizio o responsabilità illimitata. ' +
      'high: costo o vincolo rilevante e difficilmente reversibile. ' +
      'medium: svantaggio negoziabile. low: da segnalare, senza urgenza.',
  ),
  finding: z.string().min(20).describe('Che cosa dice il contratto e perché è un problema.'),
  citation: citationSchema.describe('Il passaggio che genera il rilievo.'),
  businessImpact: z
    .string()
    .min(10)
    .describe('Conseguenza concreta per l\'azienda, in termini di costo, tempo o esposizione.'),
  suggestedAction: z.string().min(10).describe('Che cosa chiedere in rinegoziazione.'),
});
export type RedFlagFinding = z.infer<typeof redFlagSchema>;

export const SLA_DIRECTIONS = ['min', 'max'] as const;
export const slaDirectionSchema = z.enum(SLA_DIRECTIONS);
export type SlaDirection = (typeof SLA_DIRECTIONS)[number];

export const slaCommitmentSchema = z.object({
  metric: z
    .string()
    .min(2)
    .describe('Nome tecnico della metrica in snake_case, es. "uptime_percent", "first_response_minutes".'),
  description: z.string().min(5).describe('La metrica in parole, come la chiama il contratto.'),
  threshold: z.number().describe('Valore soglia numerico previsto dal contratto.'),
  unit: z.string().min(1).describe('Unità di misura: "%", "minuti", "ore", "giorni".'),
  direction: slaDirectionSchema.describe(
    'min: il valore osservato deve essere maggiore o uguale alla soglia (disponibilità). ' +
      'max: deve essere minore o uguale (tempi di risposta).',
  ),
  measurementWindow: z
    .string()
    .nullable()
    .describe('Finestra di misurazione dichiarata, es. "mensile". null se non specificata.'),
  citation: citationSchema.describe('Il passaggio che stabilisce l\'impegno.'),
  penaltyPercent: z
    .number()
    .nullable()
    .describe(
      'Credito di servizio in percentuale sul canone previsto per il mancato rispetto. ' +
        'null se il contratto non prevede alcuna conseguenza economica.',
    ),
});
export type SlaCommitment = z.infer<typeof slaCommitmentSchema>;

export const contractPartySchema = z.object({
  name: z.string().min(1),
  role: z
    .string()
    .describe('Ruolo nel contratto: "fornitore", "cliente", "titolare", "responsabile".'),
});

/**
 * Output completo del modello.
 *
 * Nota sull'uso di `.nullable()` invece di `.optional()`: un campo opzionale
 * esce dalla lista `required` del JSON Schema, e un modello che non trova un
 * dato tende a omettere la chiave anziché dichiarare di non averlo trovato.
 * `null` è un'informazione; una chiave assente è un'ambiguità.
 */
export const auditFindingsSchema = z.object({
  documentType: z
    .string()
    .min(2)
    .describe('Es. "contratto di fornitura", "SLA", "DPA", "ordine di acquisto", "fattura".'),
  title: z.string().nullable(),
  parties: z.array(contractPartySchema).describe('Parti individuate. Lista vuota se non ricavabili.'),
  effectiveDate: z.string().nullable().describe('Data di decorrenza in ISO 8601, o null.'),
  endDate: z.string().nullable().describe('Data di scadenza in ISO 8601, o null.'),
  governingLaw: z.string().nullable().describe('Legge applicabile dichiarata, o null.'),
  jurisdiction: z.string().nullable().describe('Foro competente o sede arbitrale, o null.'),
  annualValue: z
    .number()
    .nullable()
    .describe('Valore annuo del contratto se indicato, come numero senza valuta. null altrimenti.'),
  currency: z.string().nullable().describe('Codice valuta ISO 4217, es. "EUR". null se assente.'),
  clauseAssessments: z
    .array(clauseAssessmentSchema)
    .describe('Una valutazione per OGNI clausola del catalogo fornito, senza saltarne nessuna.'),
  redFlags: z.array(redFlagSchema).describe('Rilievi con citazione. Lista vuota se non ce ne sono.'),
  slaCommitments: z
    .array(slaCommitmentSchema)
    .describe('Impegni di livello di servizio quantificati. Lista vuota se il documento non ne contiene.'),
  summary: z.string().min(20).describe('Sintesi in 2-4 frasi, nella lingua del documento.'),
});
export type AuditFindings = z.infer<typeof auditFindingsSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Ciò che calcoliamo noi
// ─────────────────────────────────────────────────────────────────────────────

/** Esito della verifica di una citazione contro il testo sorgente. */
export const citationVerificationSchema = z.enum(['verified', 'partial', 'unverified', 'no-source']);
export type CitationVerification = z.infer<typeof citationVerificationSchema>;

export const verifiedCitationSchema = citationSchema.extend({
  verification: citationVerificationSchema,
  /** Quota di parole della citazione ritrovate nel sorgente, fra 0 e 1. */
  matchRatio: z.number().min(0).max(1),
});
export type VerifiedCitation = z.infer<typeof verifiedCitationSchema>;

export const redFlagRecordSchema = redFlagSchema.extend({
  id: z.string(),
  citation: verifiedCitationSchema,
});
export type RedFlag = z.infer<typeof redFlagRecordSchema>;

export const missingClauseSchema = z.object({
  clauseId: z.string(),
  name: z.string(),
  category: riskCategorySchema,
  severity: riskSeveritySchema,
  /** `absent`: nessuna traccia. `partial`: presente ma incompleta. */
  status: clauseStatusSchema,
  reference: z.string().nullable(),
  whyItMatters: z.string(),
  notes: z.string(),
});
export type MissingClause = z.infer<typeof missingClauseSchema>;

export const slaViolationSchema = z.object({
  metric: z.string(),
  description: z.string(),
  committed: z.number(),
  observed: z.number(),
  unit: z.string(),
  direction: slaDirectionSchema,
  /** Scostamento assoluto dalla soglia, sempre positivo. */
  shortfall: z.number(),
  /** Scostamento in rapporto alla soglia: la lettura intuitiva, mostrata in interfaccia. */
  shortfallRatio: z.number(),
  /**
   * Rapporto che determina la gravità. Su una disponibilità percentuale è
   * calcolato sul budget di errore residuo, non sulla soglia — vedi `lib/audit/sla.ts`.
   */
  severityRatio: z.number(),
  severityBasis: z.enum(['error_budget', 'threshold']),
  severity: riskSeveritySchema,
  period: z.string().nullable(),
  penaltyPercent: z.number().nullable(),
  /** Credito maturato in valuta, se il canone annuo è noto. */
  estimatedCreditValue: z.number().nullable(),
  citation: verifiedCitationSchema.nullable(),
});
export type SLAViolation = z.infer<typeof slaViolationSchema>;

export const RECOMMENDATION_EFFORTS = ['low', 'medium', 'high'] as const;
export const recommendationEffortSchema = z.enum(RECOMMENDATION_EFFORTS);

export const recommendationSchema = z.object({
  id: z.string(),
  /** 1 = da affrontare prima della firma o entro giorni. 4 = da valutare al rinnovo. */
  priority: z.number().int().min(1).max(4),
  title: z.string(),
  action: z.string(),
  rationale: z.string(),
  category: riskCategorySchema,
  severity: riskSeveritySchema,
  effort: recommendationEffortSchema,
  /** Rilievi o clausole da cui discende: rende la raccomandazione tracciabile. */
  sourceIds: z.array(z.string()),
});
export type ActionableRecommendation = z.infer<typeof recommendationSchema>;

export const riskScoreSchema = z.object({
  /** 0 = nessun rilievo, 100 = esposizione massima. */
  overall: z.number().min(0).max(100),
  band: z.enum(RISK_BANDS),
  byCategory: z.record(riskCategorySchema, z.number().min(0).max(100)),
  counts: z.object({
    critical: z.number().int().min(0),
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  /** Spiegazione del punteggio in italiano: un numero senza motivazione non è un audit. */
  rationale: z.string(),
  /** True quando la fascia è stata alzata da un rilievo critico, non dal punteggio. */
  bandRaisedByCriticalFinding: z.boolean(),
});
export type RiskScore = z.infer<typeof riskScoreSchema>;

export const citationAuditSchema = z.object({
  total: z.number().int().min(0),
  verified: z.number().int().min(0),
  partial: z.number().int().min(0),
  unverified: z.number().int().min(0),
});
export type CitationAudit = z.infer<typeof citationAuditSchema>;

/**
 * Risultato completo dell'audit.
 *
 * I quattro blocchi richiesti da un audit di conformità fornitori — punteggio di
 * rischio, clausole mancanti, violazioni di SLA e raccomandazioni operative —
 * sono qui campi di primo livello, non annidati: sono ciò che il report espone e
 * ciò che l'esportazione JSON deve contenere senza dover essere navigata.
 */
export const contractAuditSchema = z.object({
  auditId: z.string(),
  generatedAt: z.string(),
  sourceName: z.string(),
  sourceCharacters: z.number().int().min(0),
  findings: auditFindingsSchema.omit({ redFlags: true, clauseAssessments: true }),
  riskScore: riskScoreSchema,
  redFlags: z.array(redFlagRecordSchema),
  missingClauses: z.array(missingClauseSchema),
  slaViolations: z.array(slaViolationSchema),
  recommendations: z.array(recommendationSchema),
  clausesAssessed: z.number().int().min(0),
  clausesInCatalog: z.number().int().min(0),
  citationAudit: citationAuditSchema,
  disclaimer: z.string(),
});
export type ContractAudit = z.infer<typeof contractAuditSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Ingresso
// ─────────────────────────────────────────────────────────────────────────────

/** Metrica di performance osservata, da confrontare con gli impegni contrattuali. */
export const observedMetricSchema = z.object({
  metric: z.string().min(2).describe('Deve combaciare con il `metric` dell\'impegno contrattuale.'),
  value: z.number().describe('Valore misurato nel periodo.'),
  period: z.string().nullable().describe('Periodo di riferimento, es. "2026-07". null se non noto.'),
});
export type ObservedMetric = z.infer<typeof observedMetricSchema>;

export const MAX_AUDIT_TEXT_LENGTH = 400_000;

export const auditRequestSchema = z
  .object({
    text: z.string().max(MAX_AUDIT_TEXT_LENGTH).optional(),
    attachment: z
      .object({
        name: z.string().min(1).max(255),
        mediaType: z.enum(['application/pdf', 'image/png', 'image/jpeg', 'image/webp']),
        data: z.string().min(1),
      })
      .optional(),
    sourceName: z.string().max(255).optional(),
    /** Metriche osservate: senza, gli impegni SLA sono estratti ma non verificati. */
    observedMetrics: z.array(observedMetricSchema).max(50).optional(),
    /** Valore annuo noto al cliente, usato per monetizzare i crediti di servizio. */
    annualValueOverride: z.number().positive().optional(),
  })
  .refine(
    (value) =>
      (value.text !== undefined && value.text.trim().length > 0) || value.attachment !== undefined,
    { message: 'Fornisci `text` non vuoto oppure `attachment`.' },
  );
export type AuditRequest = z.infer<typeof auditRequestSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Avvertenza
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Che cosa questo motore NON è.
 *
 * Il testo accompagna ogni audit, in interfaccia, nel JSON esportato e nel PDF.
 * Non è una formalità: un rilievo generato da un modello e presentato come
 * verdetto di conformità sposta sull'utente una responsabilità che non ha modo
 * di valutare. Uno strumento che accelera una revisione legale è utile; uno
 * strumento che sembra sostituirla è un danno.
 */
export const AUDIT_DISCLAIMER =
  'Analisi generata automaticamente a supporto della revisione contrattuale. Non costituisce ' +
  'consulenza legale né attestazione di conformità: la valutazione di adeguatezza, la decisione ' +
  'di firmare e la responsabilità verso le autorità di controllo restano in capo al titolare. ' +
  'I rilievi vanno verificati sul testo originale prima di qualunque uso negoziale.';
