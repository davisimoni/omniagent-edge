import { CLAUSE_CATALOG, getClause } from '@/lib/audit/clauses';
import {
  CATEGORY_LABELS,
  RISK_CATEGORIES,
  SEVERITY_LABELS,
  type ActionableRecommendation,
  type ClauseAssessment,
  type MissingClause,
  type RedFlag,
  type RiskBand,
  type RiskCategory,
  type RiskScore,
  type RiskSeverity,
  type SLAViolation,
} from '@/lib/audit/schema';

/**
 * Aritmetica dell'audit: clausole mancanti, punteggio di rischio, raccomandazioni.
 *
 * Modulo puro. Nessuna rete, nessun modello, nessuna data corrente: gli stessi
 * rilievi in ingresso producono sempre lo stesso punteggio in uscita. È la
 * proprietà che rende l'audit difendibile davanti a un fornitore che contesta
 * il risultato, e quella che i test verificano numero per numero.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Pesi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Punti di rischio per gravità.
 *
 * La scala è deliberatamente super-lineare: un rilievo critico pesa venti volte
 * uno basso, non quattro. In un audit di conformità la somma di venti sciocchezze
 * non equivale a una violazione dell'art. 28 GDPR, e una scala lineare produrrebbe
 * esattamente quell'equivalenza.
 */
export const SEVERITY_POINTS: Readonly<Record<RiskSeverity, number>> = {
  low: 1,
  medium: 3,
  high: 8,
  critical: 20,
};

/**
 * Una clausola presente ma incompleta pesa la metà di una del tutto assente:
 * è comunque un varco, ma il tema è già in negoziazione e la correzione è
 * un emendamento, non un capitolo nuovo.
 */
export const PARTIAL_CLAUSE_FACTOR = 0.5;

/**
 * Costante di saturazione della curva di punteggio.
 *
 * `overall = 100 · (1 − e^(−punti / K))`. Una somma lineare arriverebbe a 100 con
 * cinque rilievi e poi resterebbe piatta, rendendo indistinguibile un contratto
 * problematico da uno disastroso. Con K = 25 la scala resta leggibile su tutto
 * l'intervallo utile:
 *
 * | rilievi                  | punti | punteggio | fascia  |
 * |--------------------------|-------|-----------|---------|
 * | 1 basso                  |     1 |         4 | basso   |
 * | 1 alto                   |     8 |        27 | medio   |
 * | 1 critico                |    20 |        55 | critico¹|
 * | 3 alti                   |    24 |        62 | alto    |
 * | 2 critici + 4 alti       |    72 |        94 | critico |
 *
 * ¹ per l'innalzamento di fascia descritto in `computeRiskScore`.
 */
export const SATURATION_CONSTANT = 25;

const BAND_THRESHOLDS: readonly { min: number; band: RiskBand }[] = [
  { min: 75, band: 'critical' },
  { min: 50, band: 'high' },
  { min: 25, band: 'medium' },
  { min: 0, band: 'low' },
];

/** Converte i punti grezzi in un punteggio 0-100 saturante. */
export function pointsToScore(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  const score = 100 * (1 - Math.exp(-points / SATURATION_CONSTANT));
  return Math.round(score);
}

export function toRiskBand(score: number): RiskBand {
  const match = BAND_THRESHOLDS.find((threshold) => score >= threshold.min);
  return match?.band ?? 'low';
}

const SEVERITY_ORDER: Readonly<Record<RiskSeverity, number>> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Clausole mancanti
// ─────────────────────────────────────────────────────────────────────────────

export interface MissingClauseResult {
  readonly missing: MissingClause[];
  /** Clausole del catalogo che il modello non ha valutato affatto. */
  readonly notAssessed: string[];
  readonly assessedCount: number;
}

/**
 * Ricava le clausole mancanti per differenza rispetto al catalogo.
 *
 * Una clausola del catalogo che il modello non ha valutato **non** viene
 * considerata assente: sarebbe un rilievo senza alcuna evidenza a supporto, e
 * un audit che segnala problemi inesistenti perde credibilità alla prima
 * verifica. Finisce invece in `notAssessed`, che l'interfaccia mostra come
 * copertura incompleta dell'analisi — un'informazione onesta e diversa.
 */
export function deriveMissingClauses(
  assessments: readonly ClauseAssessment[],
): MissingClauseResult {
  const byId = new Map<string, ClauseAssessment>();
  for (const assessment of assessments) {
    // A parità di id vince la valutazione più grave: se il modello si ripete,
    // sottostimare il rischio è l'errore peggiore fra i due possibili.
    const existing = byId.get(assessment.clauseId);
    if (existing === undefined || rankStatus(assessment.status) > rankStatus(existing.status)) {
      byId.set(assessment.clauseId, assessment);
    }
  }

  const missing: MissingClause[] = [];
  const notAssessed: string[] = [];

  for (const clause of CLAUSE_CATALOG) {
    const assessment = byId.get(clause.id);
    if (assessment === undefined) {
      notAssessed.push(clause.id);
      continue;
    }
    if (assessment.status === 'present') continue;

    missing.push({
      clauseId: clause.id,
      name: clause.name,
      category: clause.category,
      severity: clause.severityIfMissing,
      status: assessment.status,
      reference: clause.reference,
      whyItMatters: clause.whyItMatters,
      notes: assessment.notes,
    });
  }

  missing.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.name.localeCompare(b.name, 'it'),
  );

  return {
    missing,
    notAssessed,
    assessedCount: [...byId.keys()].filter((id) => getClause(id) !== undefined).length,
  };
}

function rankStatus(status: ClauseAssessment['status']): number {
  return status === 'absent' ? 2 : status === 'partial' ? 1 : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Punteggio
// ─────────────────────────────────────────────────────────────────────────────

export interface ScoreInput {
  readonly redFlags: readonly RedFlag[];
  readonly missingClauses: readonly MissingClause[];
  readonly slaViolations: readonly SLAViolation[];
}

/**
 * Calcola il punteggio di rischio.
 *
 * **L'innalzamento di fascia.** Un solo rilievo critico porta la fascia a
 * `critical` anche quando il punteggio numerico direbbe di meno. È la semantica
 * dell'audit, non un'eccezione arbitraria: un revisore non promuove un fornitore
 * perché ha una sola non conformità maggiore su venti controlli. Un contratto
 * privo di clausola di notifica delle violazioni è un problema critico anche se
 * tutto il resto è impeccabile, e una media che lo diluisce sta descrivendo il
 * contratto sbagliato. Il campo `bandRaisedByCriticalFinding` rende l'intervento
 * visibile invece di nasconderlo dentro il numero.
 */
export function computeRiskScore(input: ScoreInput): RiskScore {
  const contributions: { category: RiskCategory; severity: RiskSeverity; points: number }[] = [];

  for (const flag of input.redFlags) {
    contributions.push({
      category: flag.category,
      severity: flag.severity,
      points: SEVERITY_POINTS[flag.severity],
    });
  }

  for (const clause of input.missingClauses) {
    const base = SEVERITY_POINTS[clause.severity];
    contributions.push({
      category: clause.category,
      severity: clause.severity,
      points: clause.status === 'partial' ? base * PARTIAL_CLAUSE_FACTOR : base,
    });
  }

  for (const violation of input.slaViolations) {
    // La categoria è operativa e non economica: l'assenza di penali è già
    // contabilizzata a parte come clausola mancante, e sommarla qui la
    // conterebbe due volte.
    contributions.push({
      category: 'operational',
      severity: violation.severity,
      points: SEVERITY_POINTS[violation.severity],
    });
  }

  const totalPoints = contributions.reduce((sum, entry) => sum + entry.points, 0);
  const scoreFromPoints = pointsToScore(totalPoints);

  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const entry of contributions) counts[entry.severity] += 1;

  const bandFromScore = toRiskBand(scoreFromPoints);
  const hasCritical = counts.critical > 0;
  const band: RiskBand = hasCritical ? 'critical' : bandFromScore;
  const bandRaisedByCriticalFinding = hasCritical && bandFromScore !== 'critical';

  const byCategory = {} as Record<RiskCategory, number>;
  for (const category of RISK_CATEGORIES) {
    const categoryPoints = contributions
      .filter((entry) => entry.category === category)
      .reduce((sum, entry) => sum + entry.points, 0);
    byCategory[category] = pointsToScore(categoryPoints);
  }

  return {
    overall: scoreFromPoints,
    band,
    byCategory,
    counts,
    rationale: buildRationale({ scoreFromPoints, counts, band, bandRaisedByCriticalFinding, byCategory }),
    bandRaisedByCriticalFinding,
  };
}

function buildRationale(input: {
  scoreFromPoints: number;
  counts: RiskScore['counts'];
  band: RiskBand;
  bandRaisedByCriticalFinding: boolean;
  byCategory: Record<RiskCategory, number>;
}): string {
  const total =
    input.counts.critical + input.counts.high + input.counts.medium + input.counts.low;

  if (total === 0) {
    return 'Nessun rilievo emerso dai controlli applicati. Punteggio 0/100, fascia bassa.';
  }

  const breakdown = (['critical', 'high', 'medium', 'low'] as const)
    .filter((severity) => input.counts[severity] > 0)
    .map((severity) => `${input.counts[severity]} ${SEVERITY_LABELS[severity].toLowerCase()}`)
    .join(', ');

  const worstCategory = RISK_CATEGORIES.reduce((worst, category) =>
    (input.byCategory[category] ?? 0) > (input.byCategory[worst] ?? 0) ? category : worst,
  );

  const parts = [
    `Punteggio ${input.scoreFromPoints}/100 su ${total} rilievi (${breakdown}).`,
    `L'area più esposta è "${CATEGORY_LABELS[worstCategory]}" (${input.byCategory[worstCategory] ?? 0}/100).`,
  ];

  if (input.bandRaisedByCriticalFinding) {
    parts.push(
      `La fascia è stata portata a "critica" dalla presenza di ${input.counts.critical} ` +
        'rilievo/i critico/i: una non conformità maggiore non si compensa con il resto del contratto.',
    );
  }

  return parts.join(' ');
}

// ─────────────────────────────────────────────────────────────────────────────
// Raccomandazioni
// ─────────────────────────────────────────────────────────────────────────────

const PRIORITY_BY_SEVERITY: Readonly<Record<RiskSeverity, 1 | 2 | 3 | 4>> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/**
 * Compone le raccomandazioni operative.
 *
 * Non sono chieste al modello come elenco a sé: derivano una per una da un
 * rilievo citato, da una clausola del catalogo o da uno scostamento di SLA
 * misurato. `sourceIds` conserva il collegamento, così chi legge il report può
 * risalire dalla richiesta di rinegoziazione al passaggio di contratto che la
 * giustifica — che è la differenza fra una raccomandazione e un'opinione.
 */
export function buildRecommendations(input: ScoreInput): ActionableRecommendation[] {
  const recommendations: ActionableRecommendation[] = [];

  for (const flag of input.redFlags) {
    recommendations.push({
      id: `rec-${flag.id}`,
      priority: PRIORITY_BY_SEVERITY[flag.severity],
      title: flag.title,
      action: flag.suggestedAction,
      rationale: flag.businessImpact,
      category: flag.category,
      severity: flag.severity,
      effort: flag.severity === 'critical' || flag.severity === 'high' ? 'high' : 'medium',
      sourceIds: [flag.id],
    });
  }

  for (const clause of input.missingClauses) {
    const verb = clause.status === 'partial' ? 'Integrare' : 'Introdurre';
    const reference = clause.reference !== null ? ` (${clause.reference})` : '';
    recommendations.push({
      id: `rec-clause-${clause.clauseId}`,
      priority: PRIORITY_BY_SEVERITY[clause.severity],
      title: `${verb} la clausola: ${clause.name}`,
      action:
        `${verb} nel contratto una disciplina espressa di "${clause.name}"${reference}. ` +
        (clause.notes.trim().length > 0 ? `Stato attuale: ${clause.notes.trim()}` : ''),
      rationale: clause.whyItMatters,
      category: clause.category,
      severity: clause.severity,
      effort: 'medium',
      sourceIds: [`clause-${clause.clauseId}`],
    });
  }

  for (const violation of input.slaViolations) {
    const hasPenalty = violation.penaltyPercent !== null && violation.penaltyPercent > 0;
    recommendations.push({
      id: `rec-sla-${violation.metric}`,
      priority: PRIORITY_BY_SEVERITY[violation.severity],
      title: `Scostamento SLA su ${violation.description}`,
      action: hasPenalty
        ? `Richiedere formalmente il credito di servizio del ${violation.penaltyPercent}% previsto ` +
          `dal contratto per il mancato rispetto di ${violation.committed}${violation.unit} ` +
          `(valore osservato: ${violation.observed}${violation.unit}).`
        : `Contestare lo scostamento e negoziare un credito di servizio: il contratto fissa la ` +
          `soglia di ${violation.committed}${violation.unit} ma non prevede alcuna conseguenza economica.`,
      rationale: `Valore osservato ${violation.observed}${violation.unit} contro un impegno di ${violation.committed}${violation.unit}.`,
      category: 'operational',
      severity: violation.severity,
      effort: hasPenalty ? 'low' : 'high',
      sourceIds: [`sla-${violation.metric}`],
    });
  }

  recommendations.sort(
    (a, b) =>
      a.priority - b.priority ||
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.title.localeCompare(b.title, 'it'),
  );

  return recommendations;
}
