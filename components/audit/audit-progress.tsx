'use client';

import { Check, Loader2 } from 'lucide-react';
import { AUDIT_PHASES, computeProgress, PHASE_LABELS, type AuditPhase } from '@/lib/audit/stream';
import { cn } from '@/lib/utils';

/**
 * Avanzamento dell'audit.
 *
 * Ogni valore mostrato arriva dal server: le fasi quando accadono, il numero di
 * clausole valutate mentre il modello le produce. Non c'è alcun timer che fa
 * salire la barra da solo. Una barra animata a tempo è convincente finché
 * l'operazione dura quanto previsto, e mente esattamente quando serve
 * l'informazione vera — quando è più lenta del solito e l'utente si chiede se sia
 * bloccata.
 */
export interface AuditProgressState {
  readonly phase: AuditPhase;
  readonly clausesAssessed: number;
  readonly clausesTotal: number;
  readonly redFlags: number;
  readonly slaCommitments: number;
  /** True se il documento è passato dalla lettura visiva: sposta la base della barra. */
  readonly transcribed: boolean;
}

const ALL_PHASES = AUDIT_PHASES.filter((phase) => phase !== 'queued' && phase !== 'done');

export function AuditProgress({ state }: { state: AuditProgressState }) {
  // La trascrizione compare nell'elenco solo quando avviene davvero: mostrarla
  // sempre, spenta, farebbe sembrare saltato un passaggio che su un PDF testuale
  // non ha ragione di esistere.
  const visiblePhases = state.transcribed
    ? ALL_PHASES
    : ALL_PHASES.filter((phase) => phase !== 'transcribing');

  const progress = computeProgress(
    state.phase,
    state.clausesAssessed,
    state.clausesTotal,
    state.transcribed,
  );
  const percent = Math.round(progress * 100);
  const activeIndex = visiblePhases.indexOf(state.phase as (typeof visiblePhases)[number]);

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Loader2 className="size-4 animate-spin text-accent" aria-hidden="true" />
          {PHASE_LABELS[state.phase]}
        </p>
        <span className="text-sm font-semibold tabular-nums text-accent">{percent}%</span>
      </div>

      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Avanzamento dell'audit"
        className="h-2 overflow-hidden rounded-full bg-border"
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </div>

      <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {visiblePhases.map((phase, index) => {
          const done = activeIndex > index || state.phase === 'done';
          const active = state.phase === phase;
          return (
            <li
              key={phase}
              className={cn(
                'flex items-center gap-1 text-[11px]',
                done ? 'text-success' : active ? 'font-medium text-foreground' : 'text-muted',
              )}
            >
              {done ? (
                <Check className="size-3" aria-hidden="true" />
              ) : (
                <span
                  className={cn(
                    'size-1.5 rounded-full',
                    active ? 'animate-omni-pulse bg-accent' : 'bg-border-strong',
                  )}
                  aria-hidden="true"
                />
              )}
              {PHASE_LABELS[phase]}
            </li>
          );
        })}
      </ol>

      {state.phase === 'analyzing' && (
        <p className="mt-2.5 text-[11px] tabular-nums text-muted">
          {state.clausesAssessed}/{state.clausesTotal} clausole valutate · {state.redFlags} rilievi ·{' '}
          {state.slaCommitments} impegni di servizio individuati
        </p>
      )}
    </div>
  );
}
