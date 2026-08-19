import { toVerifiedCitation } from '@/lib/audit/citations';
import type {
  ObservedMetric,
  RiskSeverity,
  SLAViolation,
  SlaCommitment,
} from '@/lib/audit/schema';

/**
 * Verifica deterministica degli impegni di livello di servizio.
 *
 * Nessun giudizio del modello entra in questo file. Dichiarare una violazione di
 * SLA ha una conseguenza economica — si richiede un credito, si contesta una
 * fattura, in certi casi si risolve il contratto — e non deve dipendere da come
 * un modello interpreta la frase "sostanzialmente in linea con l'impegno". Il
 * modello estrae la soglia dal contratto e la cita; il confronto con il valore
 * misurato è un'operazione aritmetica, e resta tale.
 */

/**
 * Tolleranza sul confronto numerico.
 *
 * Serve contro l'aritmetica in virgola mobile: `99.9` misurato e `99.9` promesso
 * possono differire all'ultima cifra dopo una divisione, e senza epsilon si
 * aprirebbe una contestazione per una violazione che non esiste.
 */
export const SLA_EPSILON = 1e-9;

/** Soglie di gravità sul rapporto di scostamento. */
export const SEVERITY_THRESHOLDS: readonly { min: number; severity: RiskSeverity }[] = [
  { min: 3, severity: 'critical' },
  { min: 1, severity: 'high' },
  { min: 0.25, severity: 'medium' },
  { min: 0, severity: 'low' },
];

/** Allinea i nomi delle metriche: il contratto scrive "Uptime %", il monitoraggio "uptime_percent". */
export function normalizeMetricName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function severityFromRatio(ratio: number): RiskSeverity {
  const match = SEVERITY_THRESHOLDS.find((threshold) => ratio >= threshold.min);
  return match?.severity ?? 'low';
}

export interface SeverityBasisResult {
  readonly ratio: number;
  readonly basis: 'error_budget' | 'threshold';
}

/**
 * Sceglie la base su cui misurare la gravità dello scostamento.
 *
 * Su una disponibilità il rapporto rispetto alla soglia è ingannevole: un
 * impegno del 99,9% disatteso con un 99,5% misurato dà uno scostamento dello
 * 0,4% sulla soglia — cioè lo 0,4% — e verrebbe classificato come irrilevante.
 * In realtà il contratto concedeva un budget di indisponibilità dello 0,1% e ne
 * sono stati consumati quattro volte tanto: circa tre ore di fermo al mese
 * invece di quarantatré minuti.
 *
 * Per questo, su una percentuale con direzione "almeno", la gravità si misura
 * sul **budget di errore residuo** (`100 − soglia`) e non sulla soglia. Su ogni
 * altra metrica — tempi di risposta, numero di incidenti — il rapporto rispetto
 * alla soglia resta la lettura corretta.
 */
export function severityBasisFor(
  commitment: Pick<SlaCommitment, 'threshold' | 'unit' | 'direction'>,
  shortfall: number,
): SeverityBasisResult {
  const isPercentage = commitment.unit.trim().startsWith('%');
  const budget = 100 - commitment.threshold;

  if (isPercentage && commitment.direction === 'min' && budget > 0 && commitment.threshold <= 100) {
    return { ratio: shortfall / budget, basis: 'error_budget' };
  }

  const denominator = Math.abs(commitment.threshold);
  if (denominator < SLA_EPSILON) {
    // Soglia zero (es. "zero incidenti gravi"): qualunque scostamento è totale.
    return { ratio: shortfall > 0 ? Number.POSITIVE_INFINITY : 0, basis: 'threshold' };
  }
  return { ratio: shortfall / denominator, basis: 'threshold' };
}

export interface SlaEvaluationOptions {
  /** Canone annuo, per monetizzare il credito di servizio. */
  readonly annualValue?: number | null;
  /** Testo sorgente, per verificare la citazione della clausola. */
  readonly sourceText?: string | null;
}

/**
 * Confronta un impegno con un valore misurato.
 *
 * Restituisce `null` quando l'impegno è rispettato: un elenco di violazioni deve
 * contenere solo violazioni, e un "rispettato" mascherato da voce con
 * scostamento zero sarebbe letto come un problema da chi scorre il report.
 */
export function evaluateSlaBreach(
  commitment: SlaCommitment,
  observed: ObservedMetric,
  options: SlaEvaluationOptions = {},
): SLAViolation | null {
  const breached =
    commitment.direction === 'min'
      ? observed.value < commitment.threshold - SLA_EPSILON
      : observed.value > commitment.threshold + SLA_EPSILON;

  if (!breached) return null;

  const shortfall = Math.abs(observed.value - commitment.threshold);
  const shortfallRatio =
    Math.abs(commitment.threshold) < SLA_EPSILON ? 1 : shortfall / Math.abs(commitment.threshold);
  const { ratio: severityRatio, basis } = severityBasisFor(commitment, shortfall);

  const estimatedCreditValue =
    typeof options.annualValue === 'number' &&
    options.annualValue > 0 &&
    commitment.penaltyPercent !== null &&
    commitment.penaltyPercent > 0
      ? // I crediti di servizio si applicano al canone del periodo di misurazione,
        // non all'annuo: il valore mensile è l'approssimazione corretta e va
        // presentata come stima, mai come importo esigibile.
        Math.round(((options.annualValue / 12) * commitment.penaltyPercent) / 100)
      : null;

  return {
    metric: commitment.metric,
    description: commitment.description,
    committed: commitment.threshold,
    observed: observed.value,
    unit: commitment.unit,
    direction: commitment.direction,
    shortfall: Math.round(shortfall * 1_000_000) / 1_000_000,
    shortfallRatio: Math.round(shortfallRatio * 10_000) / 10_000,
    severityRatio: Number.isFinite(severityRatio)
      ? Math.round(severityRatio * 10_000) / 10_000
      : severityRatio,
    severityBasis: basis,
    severity: severityFromRatio(severityRatio),
    period: observed.period,
    penaltyPercent: commitment.penaltyPercent,
    estimatedCreditValue,
    citation: toVerifiedCitation(commitment.citation, options.sourceText),
  };
}

export interface SlaVerificationResult {
  readonly violations: SLAViolation[];
  /** Metriche confrontate e risultate conformi: la prova che il controllo è stato eseguito. */
  readonly satisfied: readonly { metric: string; committed: number; observed: number; unit: string }[];
  /** Impegni contrattuali per cui non è stato fornito alcun dato misurato. */
  readonly unverifiedCommitments: readonly string[];
  /** Metriche fornite che non corrispondono ad alcun impegno del contratto. */
  readonly unmatchedMetrics: readonly string[];
}

/**
 * Confronta l'insieme degli impegni con l'insieme delle misure.
 *
 * Riporta esplicitamente sia gli impegni senza dati sia le misure senza impegno.
 * Un audit che dice solo "nessuna violazione" quando in realtà non ha ricevuto
 * dati per nove metriche su dieci sta comunicando una cosa falsa con parole vere.
 */
export function verifySlaCommitments(
  commitments: readonly SlaCommitment[],
  observedMetrics: readonly ObservedMetric[],
  options: SlaEvaluationOptions = {},
): SlaVerificationResult {
  const observedByName = new Map<string, ObservedMetric>();
  for (const metric of observedMetrics) {
    observedByName.set(normalizeMetricName(metric.metric), metric);
  }

  const violations: SLAViolation[] = [];
  const satisfied: { metric: string; committed: number; observed: number; unit: string }[] = [];
  const unverifiedCommitments: string[] = [];
  const matchedNames = new Set<string>();

  for (const commitment of commitments) {
    const key = normalizeMetricName(commitment.metric);
    const observed = observedByName.get(key);
    if (observed === undefined) {
      unverifiedCommitments.push(commitment.metric);
      continue;
    }
    matchedNames.add(key);

    const violation = evaluateSlaBreach(commitment, observed, options);
    if (violation !== null) {
      violations.push(violation);
    } else {
      satisfied.push({
        metric: commitment.metric,
        committed: commitment.threshold,
        observed: observed.value,
        unit: commitment.unit,
      });
    }
  }

  const unmatchedMetrics = observedMetrics
    .map((metric) => metric.metric)
    .filter((name) => !matchedNames.has(normalizeMetricName(name)));

  violations.sort((a, b) => b.severityRatio - a.severityRatio);

  return { violations, satisfied, unverifiedCommitments, unmatchedMetrics };
}
