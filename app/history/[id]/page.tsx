import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { AuditResult } from '@/components/audit/audit-result';
import { ReviewPanel, VersionTimeline } from '@/components/history/review-panel';
import { getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';
import { listMembers } from '@/lib/auth/repository';
import { getAudit, listVersions } from '@/lib/audits/repository';
import { hasFeature } from '@/lib/billing/plans';

export const metadata: Metadata = { title: 'Audit archiviato' };
export const dynamic = 'force-dynamic';

/**
 * Dettaglio di un audit archiviato.
 *
 * Riusa lo stesso `AuditResult` della pagina di analisi — stesse citazioni,
 * stesso punteggio, stessa radice di stampa — perché un report riletto sei mesi
 * dopo deve essere identico a quello che si è visto il primo giorno. Una vista
 * "di archivio" separata diverge, e la divergenza si scopre quando qualcuno
 * confronta due copie dello stesso audit.
 */
export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!isAuthAvailable()) notFound();

  const account = await getCurrentAccount();
  if (account === null) redirect('/login');

  const { id } = await params;
  const record = await getAudit(account.organization.id, id);
  if (record === null) notFound();

  const [versions, members] = await Promise.all([
    listVersions(account.organization.id, record.contractKey),
    listMembers(account.organization.id),
  ]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-8">
      <Link
        href="/history"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground print:hidden"
      >
        <ArrowLeft className="size-3.5" aria-hidden="true" />
        Torna alla cronologia
      </Link>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="order-2 xl:order-1">
          <AuditResult audit={record.audit} metrics={null} />
        </div>

        <div className="order-1 space-y-4 xl:order-2 xl:sticky xl:top-20 xl:self-start">
          <ReviewPanel
            auditId={record.id}
            record={record}
            members={members.map((member) => ({ id: member.id, name: member.name }))}
            canReview={hasFeature(account.organization.plan, 'reviewAssignment')}
          />
          <VersionTimeline versions={versions} currentId={record.id} />
        </div>
      </div>
    </div>
  );
}
