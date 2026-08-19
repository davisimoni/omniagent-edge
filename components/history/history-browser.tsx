'use client';

import { ArrowRight, GitCompare, Search, ShieldAlert, TrendingDown, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Badge, EmptyState, type Tone } from '@/components/ui/primitives';
import { BAND_LABELS } from '@/lib/audit/report';
import type { RiskBand } from '@/lib/audit/schema';
import { compareVersions, type AuditSummaryRecord } from '@/lib/audits/repository';
import { cn } from '@/lib/utils';

/**
 * Cronologia degli audit.
 *
 * **I filtri lavorano sul client su un elenco già caricato**, non con una
 * richiesta per battuta. Un workspace ha decine o centinaia di audit, non
 * milioni: filtrare in memoria è istantaneo e toglie sia il rimbalzo del
 * `debounce` sia una rotta da proteggere. Quando i numeri cresceranno, il
 * repository accetta già `query`, `bands` e `offset` — la paginazione lato
 * server si innesta senza cambiare questa interfaccia.
 */

const BAND_TONES: Readonly<Record<RiskBand, Tone>> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

const BANDS: readonly RiskBand[] = ['critical', 'high', 'medium', 'low'];

export function HistoryBrowser({ records }: { records: readonly AuditSummaryRecord[] }) {
  const [query, setQuery] = useState('');
  const [selectedBands, setSelectedBands] = useState<readonly RiskBand[]>([]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return records.filter((record) => {
      if (selectedBands.length > 0 && !selectedBands.includes(record.riskBand)) return false;
      if (needle.length === 0) return true;
      return (
        record.sourceName.toLowerCase().includes(needle) ||
        (record.vendorName ?? '').toLowerCase().includes(needle)
      );
    });
  }, [records, query, selectedBands]);

  // Versione precedente dello stesso contratto: è ciò che rende leggibile un
  // punteggio. "62/100" non dice nulla; "62, era 78" dice che si sta lavorando bene.
  const previousByRecord = useMemo(() => {
    const map = new Map<string, AuditSummaryRecord>();
    const byContract = new Map<string, AuditSummaryRecord[]>();
    for (const record of records) {
      const list = byContract.get(record.contractKey) ?? [];
      list.push(record);
      byContract.set(record.contractKey, list);
    }
    for (const list of byContract.values()) {
      const ordered = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      for (let index = 0; index < ordered.length - 1; index += 1) {
        const current = ordered[index];
        const previous = ordered[index + 1];
        if (current !== undefined && previous !== undefined) map.set(current.id, previous);
      }
    }
    return map;
  }, [records]);

  const toggleBand = (band: RiskBand): void => {
    setSelectedBands((current) =>
      current.includes(band) ? current.filter((entry) => entry !== band) : [...current, band],
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden="true"
          />
          <label htmlFor="history-search" className="sr-only">
            Cerca per documento o fornitore
          </label>
          <input
            id="history-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cerca per fornitore o nome del documento…"
            className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm placeholder:text-muted"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtra per rischio">
          {BANDS.map((band) => {
            const active = selectedBands.includes(band);
            return (
              <button
                key={band}
                type="button"
                onClick={() => toggleBand(band)}
                aria-pressed={active}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'border-accent bg-accent text-accent-foreground'
                    : 'border-border bg-surface text-muted hover:bg-surface-raised hover:text-foreground',
                )}
              >
                {BAND_LABELS[band]}
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-xs text-muted" role="status" aria-live="polite">
        {filtered.length === records.length
          ? `${records.length} audit`
          : `${filtered.length} di ${records.length} audit`}
      </p>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-border bg-surface">
          <EmptyState
            icon={<ShieldAlert className="size-5" />}
            title={records.length === 0 ? 'Nessun audit archiviato' : 'Nessun risultato'}
            description={
              records.length === 0
                ? 'Il primo audit che esegui compare qui, con il punteggio e i rilievi. Da lì in poi ogni revisione dello stesso contratto si confronta con la precedente.'
                : 'Nessun audit corrisponde ai filtri attivi. Prova a cambiare il testo cercato o a togliere una fascia di rischio.'
            }
          />
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((record) => (
            <li key={record.id}>
              <HistoryRow record={record} previous={previousByRecord.get(record.id) ?? null} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HistoryRow({
  record,
  previous,
}: {
  record: AuditSummaryRecord;
  previous: AuditSummaryRecord | null;
}) {
  const delta = previous === null ? null : compareVersions(previous, record);

  return (
    <Link
      href={`/history/${record.id}`}
      className={cn(
        'flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 transition-colors',
        'hover:border-border-strong hover:bg-surface-raised sm:flex-row sm:items-center',
      )}
    >
      <div className="flex shrink-0 items-center gap-3">
        <span
          className={cn(
            'flex size-12 shrink-0 flex-col items-center justify-center rounded-lg border text-sm font-semibold tabular-nums',
            record.riskBand === 'low'
              ? 'border-success/30 bg-success/10 text-success'
              : record.riskBand === 'medium'
                ? 'border-warning/30 bg-warning/10 text-warning'
                : 'border-danger/40 bg-danger/10 text-danger',
          )}
        >
          {record.riskScore}
          <span className="text-[9px] font-normal uppercase tracking-wide opacity-80">su 100</span>
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{record.sourceName}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted">
          {record.vendorName !== null && <span className="truncate">{record.vendorName}</span>}
          <span>{new Date(record.createdAt).toLocaleDateString('it-IT')}</span>
          {record.createdByName !== null && <span>· {record.createdByName}</span>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={BAND_TONES[record.riskBand]}>{BAND_LABELS[record.riskBand]}</Badge>
        {record.criticalCount > 0 && (
          <Badge tone="danger">{record.criticalCount} critici</Badge>
        )}
        {record.missingClauseCount > 0 && (
          <Badge tone="warning">{record.missingClauseCount} clausole</Badge>
        )}
        {record.reviewStatus === 'pending' && (
          <Badge tone="accent">
            In revisione{record.assignedToName !== null ? ` · ${record.assignedToName}` : ''}
          </Badge>
        )}

        {delta !== null && delta.direction !== 'unchanged' && (
          <Badge tone={delta.direction === 'improved' ? 'success' : 'danger'}>
            {delta.direction === 'improved' ? (
              <TrendingDown className="size-3" aria-hidden="true" />
            ) : (
              <TrendingUp className="size-3" aria-hidden="true" />
            )}
            {/* Un punteggio che scende è un miglioramento: misura il rischio. */}
            {delta.scoreDelta > 0 ? '+' : ''}
            {delta.scoreDelta} vs versione precedente
          </Badge>
        )}
        {delta !== null && (
          <GitCompare className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
        )}

        <ArrowRight className="size-4 shrink-0 text-muted" aria-hidden="true" />
      </div>
    </Link>
  );
}
