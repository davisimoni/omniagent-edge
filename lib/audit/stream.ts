import type { ContractAudit } from '@/lib/audit/schema';

/**
 * Protocollo di avanzamento dell'audit.
 *
 * La barra di avanzamento dell'interfaccia mostra dati reali, non un'animazione
 * temporizzata: le fasi arrivano dal server quando accadono e i conteggi
 * (clausole valutate, rilievi emersi) sono letti dall'oggetto parziale mentre il
 * modello lo produce. Una barra finta che avanza a tempo mente proprio nel caso
 * in cui l'utente la sta guardando davvero, cioè quando l'operazione è lenta.
 *
 * Il formato è NDJSON: un oggetto JSON per riga. Rispetto a SSE non richiede
 * convenzioni di prefisso, si legge con quattro righe di codice sul client e
 * attraversa i proxy senza configurazione.
 */

export const AUDIT_PHASES = [
  'queued',
  'reading',
  'analyzing',
  'verifying',
  'scoring',
  'done',
] as const;
export type AuditPhase = (typeof AUDIT_PHASES)[number];

export const PHASE_LABELS: Readonly<Record<AuditPhase, string>> = {
  queued: 'In coda',
  reading: 'Lettura del documento',
  analyzing: 'Analisi delle clausole',
  verifying: 'Verifica delle citazioni',
  scoring: 'Calcolo del punteggio',
  done: 'Completato',
};

/** Peso di ciascuna fase sulla barra: l'analisi domina, il resto è quasi istantaneo. */
export const PHASE_WEIGHTS: Readonly<Record<AuditPhase, number>> = {
  queued: 0,
  reading: 0.08,
  analyzing: 0.82,
  verifying: 0.94,
  scoring: 0.98,
  done: 1,
};

export interface AuditMetrics {
  readonly modelId: string;
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly costUsd: number | null;
}

export type AuditStreamEvent =
  | { readonly type: 'phase'; readonly phase: AuditPhase }
  | {
      readonly type: 'progress';
      /** Clausole del catalogo già valutate dal modello. */
      readonly clausesAssessed: number;
      readonly clausesTotal: number;
      readonly redFlags: number;
      readonly slaCommitments: number;
    }
  | { readonly type: 'result'; readonly audit: ContractAudit; readonly metrics: AuditMetrics }
  | { readonly type: 'error'; readonly error: string; readonly message: string };

/**
 * Avanzamento complessivo fra 0 e 1.
 *
 * Durante l'analisi — la fase lunga — l'avanzamento interpola sulla quota di
 * clausole già valutate, così la barra si muove per un motivo verificabile.
 */
export function computeProgress(
  phase: AuditPhase,
  clausesAssessed: number,
  clausesTotal: number,
): number {
  if (phase !== 'analyzing') return PHASE_WEIGHTS[phase];
  if (clausesTotal <= 0) return PHASE_WEIGHTS.reading;
  const span = PHASE_WEIGHTS.analyzing - PHASE_WEIGHTS.reading;
  const ratio = Math.min(1, Math.max(0, clausesAssessed / clausesTotal));
  return PHASE_WEIGHTS.reading + span * ratio;
}

/**
 * Legge uno stream NDJSON riga per riga.
 *
 * Il buffer è necessario perché un chunk di rete non coincide con una riga: può
 * spezzare un oggetto JSON a metà o portarne tre insieme. Fare `JSON.parse` sul
 * chunk grezzo funziona in sviluppo e si rompe in produzione, dove i pacchetti
 * si frammentano davvero.
 */
export async function* readNdjsonStream<T>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line.length > 0) yield JSON.parse(line) as T;
        newlineIndex = buffer.indexOf('\n');
      }
    }

    const tail = buffer.trim();
    if (tail.length > 0) yield JSON.parse(tail) as T;
  } finally {
    reader.releaseLock();
  }
}
