'use client';

import { Check, ClipboardCheck, Loader2, Lock, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Badge, Button, type Tone } from '@/components/ui/primitives';
import { BAND_LABELS } from '@/lib/audit/report';
import type { AuditSummaryRecord, ReviewStatus } from '@/lib/audits/repository';
import { compareVersions } from '@/lib/audits/repository';
import { cn } from '@/lib/utils';

/**
 * Revisione umana di un audit.
 *
 * **L'analisi automatica non chiude nulla: propone.** Questo pannello è il punto
 * in cui una persona se ne assume la responsabilità, e per questo registra chi
 * ha deciso e con quali note. Un audit approvato senza nome accanto non è una
 * decisione: è un file.
 */

const STATUS_META: Readonly<Record<ReviewStatus, { label: string; tone: Tone }>> = {
  unassigned: { label: 'Non assegnato', tone: 'neutral' },
  pending: { label: 'In revisione', tone: 'accent' },
  approved: { label: 'Approvato', tone: 'success' },
  rejected: { label: 'Respinto', tone: 'danger' },
};

export interface Member {
  readonly id: string;
  readonly name: string;
}

export function ReviewPanel({
  auditId,
  record,
  members,
  canReview,
}: {
  auditId: string;
  record: AuditSummaryRecord;
  members: readonly Member[];
  canReview: boolean;
}) {
  const router = useRouter();
  const selectId = useId();
  const notesId = useId();

  const [assignee, setAssignee] = useState(record.assignedTo ?? '');
  const [notes, setNotes] = useState(record.reviewNotes ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const status = STATUS_META[record.reviewStatus];

  const send = async (body: Record<string, unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/audits/${auditId}/review`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        setError(
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message: unknown }).message)
            : 'Aggiornamento non riuscito.',
        );
        return;
      }
      router.refresh();
    } catch {
      setError('Impossibile contattare il server.');
    } finally {
      setBusy(false);
    }
  };

  if (!canReview) {
    return (
      <section className="rounded-xl border border-border bg-surface p-4 print:hidden">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <Lock className="size-4 text-muted" aria-hidden="true" />
          Revisione di squadra
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-muted">
          Assegnare un audit a un collega, tracciarne l&apos;esito e ricevere l&apos;avviso su Slack
          o Teams quando emerge un rilievo critico sono inclusi dal piano Pro.
        </p>
        <Link
          href="/pricing"
          className="mt-2.5 inline-flex text-xs font-medium text-accent underline-offset-2 hover:underline"
        >
          Vedi che cosa cambia
        </Link>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-surface p-4 print:hidden">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <ClipboardCheck className="size-4 text-accent" aria-hidden="true" />
          Revisione
        </h2>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="mt-3 space-y-2.5">
        <div>
          <label htmlFor={selectId} className="mb-1 block text-xs font-medium text-muted">
            Assegna a
          </label>
          <div className="flex gap-1.5">
            <select
              id={selectId}
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
            >
              <option value="">Nessuno</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <Button
              variant="secondary"
              onClick={() => void send({ assigneeId: assignee.length > 0 ? assignee : null })}
              disabled={busy || assignee === (record.assignedTo ?? '')}
              className="shrink-0 px-2.5 py-1.5 text-xs"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : 'Assegna'}
            </Button>
          </div>
        </div>

        <div>
          <label htmlFor={notesId} className="mb-1 block text-xs font-medium text-muted">
            Note di revisione
          </label>
          <textarea
            id={notesId}
            value={notes}
            onChange={(event) => setNotes(event.target.value.slice(0, 2000))}
            rows={3}
            placeholder="Che cosa è stato verificato, che cosa resta da negoziare…"
            className="scrollbar-slim w-full resize-y rounded-lg border border-border bg-background px-2.5 py-2 text-xs leading-relaxed placeholder:text-muted"
          />
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button
            onClick={() => void send({ status: 'approved', notes })}
            disabled={busy}
            className="px-3 py-1.5 text-xs"
          >
            <Check className="size-3.5" aria-hidden="true" />
            Approva
          </Button>
          <Button
            variant="secondary"
            onClick={() => void send({ status: 'rejected', notes })}
            disabled={busy}
            className="px-3 py-1.5 text-xs"
          >
            <X className="size-3.5" aria-hidden="true" />
            Respingi
          </Button>
        </div>

        {error !== null && (
          <p role="alert" className="text-[11px] leading-relaxed text-danger">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Storico delle versioni dello stesso contratto.
 *
 * Il confronto è fra ciascuna versione e quella immediatamente precedente, non
 * con la prima: chi rinegozia vuole sapere se l'ultimo giro ha migliorato
 * qualcosa, non quanto si è mossi dal punto di partenza di due anni fa.
 */
export function VersionTimeline({
  versions,
  currentId,
}: {
  versions: readonly AuditSummaryRecord[];
  currentId: string;
}) {
  if (versions.length < 2) return null;

  return (
    <section className="rounded-xl border border-border bg-surface p-4 print:hidden">
      <h2 className="text-sm font-semibold tracking-tight">
        Versioni di questo contratto ({versions.length})
      </h2>
      <ol className="mt-3 space-y-1.5">
        {versions.map((version, index) => {
          const previous = versions[index + 1];
          const delta = previous === undefined ? null : compareVersions(previous, version);
          const isCurrent = version.id === currentId;

          return (
            <li key={version.id}>
              <Link
                href={`/history/${version.id}`}
                aria-current={isCurrent ? 'page' : undefined}
                className={cn(
                  'flex flex-wrap items-center gap-2 rounded-lg border px-2.5 py-2 text-xs transition-colors',
                  isCurrent
                    ? 'border-accent bg-accent-soft'
                    : 'border-border bg-surface-raised hover:border-border-strong',
                )}
              >
                <span className="font-semibold tabular-nums">{version.riskScore}</span>
                <span className="text-muted">{BAND_LABELS[version.riskBand]}</span>
                <span className="text-muted">
                  {new Date(version.createdAt).toLocaleDateString('it-IT')}
                </span>
                <span className="min-w-0 flex-1 truncate text-muted">{version.sourceName}</span>
                {delta !== null && delta.direction !== 'unchanged' && (
                  <Badge tone={delta.direction === 'improved' ? 'success' : 'danger'}>
                    {delta.scoreDelta > 0 ? '+' : ''}
                    {delta.scoreDelta}
                  </Badge>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">
        Ogni variazione è rispetto alla versione immediatamente precedente. Un punteggio che
        scende è un miglioramento: misura il rischio, non la qualità.
      </p>
    </section>
  );
}
