import { ArrowRight, ClipboardCheck, History, ShieldAlert, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { HistoryBrowser } from '@/components/history/history-browser';
import { Badge, StatTile } from '@/components/ui/primitives';
import { authUnavailableReason, getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';
import { getHistoryStats, listAudits } from '@/lib/audits/repository';
import { getPlan } from '@/lib/billing/plans';
import { getUsageSummary } from '@/lib/billing/quota';

export const metadata: Metadata = {
  title: 'Cronologia audit',
  description: 'Tutti gli audit del workspace, con filtri per rischio e confronto fra versioni.',
};

export const dynamic = 'force-dynamic';

/**
 * Cronologia del workspace.
 *
 * È la pagina che trasforma uno strumento in un archivio: il valore del primo
 * audit è il report, il valore del ventesimo è poterli confrontare. Per questo
 * l'intestazione mostra prima i numeri aggregati — quanti contratti, quanti
 * critici, quanti in attesa di revisione — e solo dopo l'elenco.
 */
export default async function HistoryPage() {
  if (!isAuthAvailable()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <History className="mx-auto size-8 text-muted" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Cronologia non disponibile</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{authUnavailableReason()}</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          L&apos;audit resta pienamente utilizzabile: l&apos;analisi funziona per intero, ma il
          report non viene archiviato.
        </p>
        <Link
          href="/audit"
          className="mt-5 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground"
        >
          Vai all&apos;audit
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  const account = await getCurrentAccount();
  if (account === null) redirect('/login');

  const [records, stats, usage] = await Promise.all([
    listAudits({ organizationId: account.organization.id, limit: 200 }),
    getHistoryStats(account.organization.id),
    getUsageSummary(account.organization.id),
  ]);

  const plan = getPlan(account.organization.plan);
  const remaining =
    plan.auditsPerMonth === null ? null : Math.max(0, plan.auditsPerMonth - usage.audits);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {account.organization.name}
          </h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">
            Ogni audit resta qui. Alla revisione successiva dello stesso contratto vedrai che cosa è
            cambiato, e se il rischio è salito o sceso.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={plan.id === 'free' ? 'neutral' : 'accent'}>Piano {plan.name}</Badge>
          {remaining !== null && (
            <Badge tone={remaining === 0 ? 'danger' : remaining <= 1 ? 'warning' : 'neutral'}>
              {remaining} audit rimasti questo mese
            </Badge>
          )}
          <Link
            href="/audit"
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            Nuovo audit
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Audit archiviati" value={stats.total} />
        <StatTile
          label="A rischio critico"
          value={stats.critical}
          tone={stats.critical > 0 ? 'danger' : 'neutral'}
          hint={stats.critical > 0 ? 'Da rivedere prima della firma' : undefined}
        />
        <StatTile
          label="In attesa di revisione"
          value={stats.pendingReview}
          tone={stats.pendingReview > 0 ? 'warning' : 'neutral'}
        />
        <StatTile
          label="Punteggio medio"
          value={stats.averageScore ?? '—'}
          hint={stats.averageScore === null ? undefined : 'su 100'}
        />
      </div>

      {stats.critical > 0 && (
        <div
          role="status"
          className="mb-4 flex items-start gap-2.5 rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm leading-relaxed text-danger"
        >
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <p>
            <strong>
              {stats.critical} {stats.critical === 1 ? 'contratto' : 'contratti'} a rischio critico
            </strong>{' '}
            nel workspace. Un rilievo critico espone a sanzione, interruzione del servizio o
            responsabilità non limitata: vanno chiusi prima della firma, non al rinnovo.
          </p>
        </div>
      )}

      {stats.pendingReview > 0 && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-muted">
          <ClipboardCheck className="size-3.5 shrink-0" aria-hidden="true" />
          {stats.pendingReview} audit assegnati e in attesa di revisione manuale.
        </div>
      )}

      <HistoryBrowser records={records} />

      {records.length >= 2 && (
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-muted">
          <TrendingUp className="size-3.5" aria-hidden="true" />
          Le variazioni confrontano un audit con la versione precedente dello stesso contratto,
          raggruppata per nome del documento. Se due contratti diversi risultassero accostati, i
          nomi originali restano visibili per accorgersene.
        </p>
      )}
    </div>
  );
}
