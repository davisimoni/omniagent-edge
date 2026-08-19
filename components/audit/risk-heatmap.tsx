'use client';

import { CATEGORY_LABELS, type RiskBand, type RiskCategory, type RiskScore } from '@/lib/audit/schema';
import { toRiskBand } from '@/lib/audit/scoring';
import { cn } from '@/lib/utils';

/**
 * Mappa di calore del rischio per area.
 *
 * Il colore **non** è l'unico veicolo dell'informazione: ogni mattonella riporta
 * il punteggio in cifre e la fascia in parole. Una heatmap che comunica solo con
 * il colore è illeggibile per chi ha un deficit di percezione cromatica e
 * scompare del tutto nella stampa in bianco e nero — cioè proprio nel formato in
 * cui un report di audit circola più spesso.
 */

const BAND_STYLES: Readonly<Record<RiskBand, { tile: string; text: string; label: string }>> = {
  low: {
    tile: 'border-success/30 bg-success/10',
    text: 'text-success',
    label: 'Basso',
  },
  medium: {
    tile: 'border-warning/30 bg-warning/10',
    text: 'text-warning',
    label: 'Medio',
  },
  high: {
    tile: 'border-danger/30 bg-danger/10',
    text: 'text-danger',
    label: 'Alto',
  },
  critical: {
    tile: 'border-danger/60 bg-danger/20',
    text: 'text-danger',
    label: 'Critico',
  },
};

export function RiskHeatmap({ riskScore }: { riskScore: RiskScore }) {
  const entries = (Object.keys(CATEGORY_LABELS) as RiskCategory[]).map((category) => ({
    category,
    score: riskScore.byCategory[category] ?? 0,
  }));

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        {entries.map(({ category, score }) => {
          const band = toRiskBand(score);
          const style = score === 0 ? null : BAND_STYLES[band];
          return (
            <div
              key={category}
              className={cn(
                'rounded-lg border px-2.5 py-2',
                style?.tile ?? 'border-border bg-surface-raised',
              )}
            >
              <p className="truncate text-[11px] font-medium text-muted" title={CATEGORY_LABELS[category]}>
                {CATEGORY_LABELS[category]}
              </p>
              <p
                className={cn(
                  'mt-0.5 text-lg font-semibold tabular-nums leading-none',
                  style?.text ?? 'text-muted',
                )}
              >
                {score}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted">
                {score === 0 ? 'nessun rilievo' : style?.label}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Punteggio per area su scala 0-100. Le aree senza rilievi restano a zero: non significa
        che siano state approvate, ma che i controlli applicati non hanno prodotto scostamenti.
      </p>
    </div>
  );
}

/** Indicatore complessivo: cifra grande, fascia in parole, motivazione sotto. */
export function RiskScoreDial({ riskScore }: { riskScore: RiskScore }) {
  const style = BAND_STYLES[riskScore.band];
  const circumference = 2 * Math.PI * 42;
  const dash = (riskScore.overall / 100) * circumference;

  return (
    <div className="flex items-center gap-4">
      <div className="relative shrink-0">
        <svg width="104" height="104" viewBox="0 0 104 104" role="img" aria-label={`Punteggio di rischio ${riskScore.overall} su 100, fascia ${style.label}`}>
          <circle cx="52" cy="52" r="42" fill="none" stroke="var(--border)" strokeWidth="8" />
          <circle
            cx="52"
            cy="52"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="8"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${circumference}`}
            transform="rotate(-90 52 52)"
            className={style.text}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={cn('text-2xl font-semibold tabular-nums leading-none', style.text)}>
            {riskScore.overall}
          </span>
          <span className="text-[10px] uppercase tracking-wide text-muted">su 100</span>
        </div>
      </div>

      <div className="min-w-0">
        <p className={cn('text-lg font-semibold leading-tight', style.text)}>
          Rischio {style.label.toLowerCase()}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{riskScore.rationale}</p>
        {riskScore.bandRaisedByCriticalFinding && (
          <p className="mt-1.5 rounded border border-danger/30 bg-danger/10 px-2 py-1 text-[11px] leading-relaxed text-danger">
            Fascia alzata da un rilievo critico: il punteggio numerico direbbe meno, ma una non
            conformità maggiore non si compensa con il resto del contratto.
          </p>
        )}
      </div>
    </div>
  );
}
