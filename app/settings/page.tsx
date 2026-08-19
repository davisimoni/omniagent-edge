import { Activity, ArrowRight, Bell, CreditCard, Settings2, User, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  DiagnosticsPanel,
  NotificationsPanel,
  ProfilePanel,
  SignOutButton,
} from '@/components/settings/settings-panels';
import { Badge, StatTile } from '@/components/ui/primitives';
import { authUnavailableReason, getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';
import { listMembers } from '@/lib/auth/repository';
import { getPlan, hasFeature } from '@/lib/billing/plans';
import { getUsageSummary } from '@/lib/billing/quota';
import { getNotificationSettings } from '@/lib/notifications/dispatch';
import { formatCostUsd } from '@/lib/metrics';

export const metadata: Metadata = {
  title: 'Impostazioni',
  description: 'Profilo, workspace, piano, notifiche al team e diagnostica.',
};

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  if (!isAuthAvailable()) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center sm:px-6">
        <Settings2 className="mx-auto size-8 text-muted" aria-hidden="true" />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Impostazioni non disponibili</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{authUnavailableReason()}</p>
      </div>
    );
  }

  const account = await getCurrentAccount();
  if (account === null) redirect('/login');

  const [members, usage, notifications] = await Promise.all([
    listMembers(account.organization.id),
    getUsageSummary(account.organization.id),
    getNotificationSettings(account.organization.id),
  ]);

  const plan = getPlan(account.organization.plan);
  const remaining =
    plan.auditsPerMonth === null ? null : Math.max(0, plan.auditsPerMonth - usage.audits);
  const canNotify = hasFeature(plan.id, 'teamNotifications');
  const isAdmin = account.role !== 'member';

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Impostazioni</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Profilo, workspace, piano e avvisi al team. Tutto quello che decide come lavora
          OmniAgent per la tua squadra.
        </p>
      </header>

      <div className="space-y-4">
        {/* ── Piano ────────────────────────────────────────────────────────── */}
        <Section
          icon={<CreditCard className="size-4" />}
          title="Piano e consumi"
          description="Che cosa è incluso e quanto ne hai usato in questo periodo."
        >
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <StatTile label="Piano" value={plan.name} tone={plan.id === 'free' ? 'neutral' : 'accent'} />
            <StatTile
              label="Audit usati"
              value={plan.auditsPerMonth === null ? usage.audits : `${usage.audits}/${plan.auditsPerMonth}`}
              tone={remaining !== null && remaining === 0 ? 'danger' : 'neutral'}
            />
            <StatTile
              label="Rimasti"
              value={remaining === null ? '∞' : remaining}
              hint={remaining === null ? 'senza tetto' : 'in questo mese'}
            />
            <StatTile
              label="Costo stimato"
              value={formatCostUsd(usage.costUsd)}
              hint="modello, questo periodo"
            />
          </div>

          {account.organization.currentPeriodEnd !== null && (
            <p className="mb-3 text-xs text-muted">
              Rinnovo il{' '}
              {new Date(account.organization.currentPeriodEnd).toLocaleDateString('it-IT')} · stato{' '}
              <Badge tone={account.organization.planStatus === 'active' ? 'success' : 'warning'}>
                {account.organization.planStatus}
              </Badge>
            </p>
          )}

          {plan.id === 'free' && (
            <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3">
              <p className="text-xs leading-relaxed">
                <strong>Il piano Pro toglie il tetto dove si sente di più:</strong> 100 audit al
                mese, confronto fra versioni dello stesso contratto, assegnazione a un revisore e
                avviso su Slack quando emerge un rilievo critico — cioè quando serve saperlo subito.
              </p>
              <Link
                href="/pricing"
                className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-accent underline-offset-2 hover:underline"
              >
                Vedi i piani
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
          )}
        </Section>

        {/* ── Profilo ──────────────────────────────────────────────────────── */}
        <Section
          icon={<User className="size-4" />}
          title="Profilo e workspace"
          description="Il nome che i tuoi colleghi vedono accanto agli audit che esegui."
        >
          <ProfilePanel
            initialName={account.user.name}
            email={account.user.email}
            initialWorkspace={account.organization.name}
            canRenameWorkspace={isAdmin}
          />
        </Section>

        {/* ── Notifiche ────────────────────────────────────────────────────── */}
        <Section
          icon={<Bell className="size-4" />}
          title="Avvisi al team"
          description="Dove far arrivare un rilievo critico, senza che nessuno debba aprire la piattaforma."
        >
          <NotificationsPanel initial={notifications} enabled={canNotify} />
        </Section>

        {/* ── Team ─────────────────────────────────────────────────────────── */}
        <Section
          icon={<Users className="size-4" />}
          title={`Squadra (${members.length}${plan.seats !== null ? ` di ${plan.seats}` : ''})`}
          description="Chi può eseguire audit e revisionarli in questo workspace."
        >
          <ul className="space-y-1.5">
            {members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-xs"
              >
                <span className="font-medium">{member.name}</span>
                <span className="min-w-0 flex-1 truncate text-muted">{member.email}</span>
                <Badge tone={member.role === 'owner' ? 'accent' : 'neutral'}>{member.role}</Badge>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] leading-relaxed text-muted">
            L&apos;invito di nuovi membri via email non è ancora attivo: lo schema è pronto
            (tabella <code className="font-mono">invitations</code>, con token conservato come
            digest) e richiede un fornitore di posta configurato.
          </p>
        </Section>

        {/* ── Diagnostica ──────────────────────────────────────────────────── */}
        <Section
          icon={<Activity className="size-4" />}
          title="Diagnostica"
          description="Verifica che le dipendenze rispondano, con latenze misurate sul momento."
        >
          <DiagnosticsPanel />
        </Section>

        {/* ── Sessione ─────────────────────────────────────────────────────── */}
        <Section
          icon={<Settings2 className="size-4" />}
          title="Sessione"
          description="Esci da questo dispositivo. Gli altri restano connessi finché non cambi la password."
        >
          <SignOutButton />
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface">
      <div className="border-b border-border px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-semibold tracking-tight">
          <span className="text-accent" aria-hidden="true">
            {icon}
          </span>
          {title}
        </h2>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
