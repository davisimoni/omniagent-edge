'use client';

import {
  Activity,
  AlertCircle,
  Check,
  CreditCard,
  Loader2,
  Lock,
  LogOut,
  UserPlus,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Badge, Button, type Tone } from '@/components/ui/primitives';
import type { NotificationSettings } from '@/lib/notifications/dispatch';
import type { RiskBand } from '@/lib/audit/schema';
import { BAND_LABELS } from '@/lib/audit/report';
import { cn } from '@/lib/utils';

/**
 * Pannelli interattivi delle impostazioni.
 *
 * Ogni pannello salva per conto proprio invece di avere un unico "Salva" in
 * fondo alla pagina. Un modulo unico costringe a rileggere tutto per capire che
 * cosa si sta per cambiare, e un errore in una sezione blocca il salvataggio
 * delle altre — che è il modo più efficace per far perdere a qualcuno una
 * modifica che aveva già scritto.
 */

function useSaver() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async (url: string, body: unknown): Promise<boolean> => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(url, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message: unknown }).message)
            : 'Salvataggio non riuscito.',
        );
        return false;
      }

      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      router.refresh();

      if (
        typeof payload === 'object' &&
        payload !== null &&
        (payload as { signedOut?: unknown }).signedOut === true
      ) {
        router.push('/login');
      }
      return true;
    } catch {
      setError('Impossibile contattare il server.');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { save, busy, error, saved };
}

function Status({ busy, error, saved }: { busy: boolean; error: string | null; saved: boolean }) {
  if (error !== null) {
    return (
      <p role="alert" className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
        <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        {error}
      </p>
    );
  }
  if (saved) {
    return (
      <p role="status" className="flex items-center gap-1.5 text-[11px] text-success">
        <Check className="size-3.5" aria-hidden="true" />
        Salvato
      </p>
    );
  }
  if (busy) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-muted">
        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        Salvataggio…
      </p>
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────

export function ProfilePanel({
  initialName,
  email,
  initialWorkspace,
  canRenameWorkspace,
}: {
  initialName: string;
  email: string;
  initialWorkspace: string;
  canRenameWorkspace: boolean;
}) {
  const nameId = useId();
  const workspaceId = useId();
  const passwordId = useId();

  const [name, setName] = useState(initialName);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [password, setPassword] = useState('');
  const { save, busy, error, saved } = useSaver();

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={nameId} className="mb-1 block text-xs font-medium text-muted">
          Il tuo nome
        </label>
        <input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        />
      </div>

      <div>
        <span className="mb-1 block text-xs font-medium text-muted">Email</span>
        <p className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-sm text-muted">
          {email}
        </p>
        <p className="mt-1 text-[11px] text-muted">
          L&apos;email identifica l&apos;account e non è modificabile da qui.
        </p>
      </div>

      <div>
        <label htmlFor={workspaceId} className="mb-1 block text-xs font-medium text-muted">
          Nome del workspace
        </label>
        <input
          id={workspaceId}
          value={workspace}
          onChange={(event) => setWorkspace(event.target.value)}
          disabled={!canRenameWorkspace}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm disabled:opacity-60"
        />
        {!canRenameWorkspace && (
          <p className="mt-1 text-[11px] text-muted">
            Solo chi amministra il workspace può rinominarlo.
          </p>
        )}
      </div>

      <div>
        <label htmlFor={passwordId} className="mb-1 block text-xs font-medium text-muted">
          Nuova password
        </label>
        <input
          id={passwordId}
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="new-password"
          placeholder="Lascia vuoto per non cambiarla"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted"
        />
        <p className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted">
          <Lock className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          Cambiarla disconnette ogni dispositivo, questo compreso. È voluto: è ciò che serve
          quando si sospetta che qualcuno la conosca.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            void save('/api/settings/profile', {
              name,
              ...(canRenameWorkspace ? { workspaceName: workspace } : {}),
              ...(password.length > 0 ? { newPassword: password } : {}),
            })
          }
          disabled={busy}
          className="px-3 py-2 text-xs"
        >
          Salva
        </Button>
        <Status busy={busy} error={error} saved={saved} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

const BANDS: readonly RiskBand[] = ['low', 'medium', 'high', 'critical'];

export function NotificationsPanel({
  initial,
  enabled,
}: {
  initial: NotificationSettings;
  enabled: boolean;
}) {
  const slackId = useId();
  const teamsId = useId();
  const emailsId = useId();
  const bandId = useId();

  const [slack, setSlack] = useState(initial.slackWebhookUrl ?? '');
  const [teams, setTeams] = useState(initial.teamsWebhookUrl ?? '');
  const [emails, setEmails] = useState(initial.emailRecipients.join(', '));
  const [band, setBand] = useState<RiskBand>(initial.notifyFromBand);
  const { save, busy, error, saved } = useSaver();

  if (!enabled) {
    return (
      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <p className="text-xs leading-relaxed text-muted">
          Quando un audit rileva un rilievo critico, il piano Pro avvisa il canale del team su
          Slack o Teams e per email — così chi deve intervenire lo sa senza aprire la piattaforma.
        </p>
        <Link
          href="/pricing"
          className="mt-2 inline-flex text-xs font-medium text-accent underline-offset-2 hover:underline"
        >
          Vedi che cosa include Pro
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={bandId} className="mb-1 block text-xs font-medium text-muted">
          Avvisa a partire da
        </label>
        <select
          id={bandId}
          value={band}
          onChange={(event) => setBand(event.target.value as RiskBand)}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm"
        >
          {BANDS.map((entry) => (
            <option key={entry} value={entry}>
              Rischio {BAND_LABELS[entry].toLowerCase()}
            </option>
          ))}
        </select>
        <p className="mt-1 text-[11px] leading-relaxed text-muted">
          Il valore predefinito è «critico». Un canale che riceve ogni rilievo viene silenziato
          entro una settimana, e da quel momento non avvisa più nemmeno dei critici.
        </p>
      </div>

      <div>
        <label htmlFor={slackId} className="mb-1 block text-xs font-medium text-muted">
          Webhook Slack
        </label>
        <input
          id={slackId}
          value={slack}
          onChange={(event) => setSlack(event.target.value)}
          placeholder="https://hooks.slack.com/services/…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs placeholder:font-sans placeholder:text-muted"
        />
      </div>

      <div>
        <label htmlFor={teamsId} className="mb-1 block text-xs font-medium text-muted">
          Webhook Microsoft Teams
        </label>
        <input
          id={teamsId}
          value={teams}
          onChange={(event) => setTeams(event.target.value)}
          placeholder="https://….webhook.office.com/…"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs placeholder:font-sans placeholder:text-muted"
        />
      </div>

      <div>
        <label htmlFor={emailsId} className="mb-1 block text-xs font-medium text-muted">
          Email da avvisare
        </label>
        <input
          id={emailsId}
          value={emails}
          onChange={(event) => setEmails(event.target.value)}
          placeholder="legale@azienda.it, procurement@azienda.it"
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-xs placeholder:text-muted"
        />
        <p className="mt-1 text-[11px] text-muted">Separate da virgola.</p>
      </div>

      <div className="flex items-center gap-3">
        <Button
          onClick={() =>
            void save('/api/settings/notifications', {
              slackWebhookUrl: slack.trim().length > 0 ? slack.trim() : null,
              teamsWebhookUrl: teams.trim().length > 0 ? teams.trim() : null,
              emailRecipients: emails
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0),
              notifyFromBand: band,
            })
          }
          disabled={busy}
          className="px-3 py-2 text-xs"
        >
          Salva
        </Button>
        <Status busy={busy} error={error} saved={saved} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

interface DependencyCheck {
  readonly name: string;
  readonly status: 'ok' | 'degraded' | 'down' | 'not_configured';
  readonly latencyMs: number | null;
  readonly detail: string;
}

const STATUS_TONES: Readonly<Record<DependencyCheck['status'], Tone>> = {
  ok: 'success',
  degraded: 'warning',
  down: 'danger',
  not_configured: 'neutral',
};

const STATUS_LABELS: Readonly<Record<DependencyCheck['status'], string>> = {
  ok: 'attiva',
  degraded: 'lenta',
  down: 'non risponde',
  not_configured: 'non configurata',
};

/**
 * Diagnostica su richiesta.
 *
 * Non si esegue al caricamento della pagina: ogni sonda è un round-trip reale
 * verso database, Redis e modello, e farlo a ogni apertura delle impostazioni
 * significherebbe pagare tre chiamate per una pagina che di solito si apre per
 * cambiare un nome.
 */
export function DiagnosticsPanel() {
  const [checks, setChecks] = useState<readonly DependencyCheck[] | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/health/deep');
      if (!response.ok) {
        setError(`La diagnostica ha risposto ${response.status}.`);
        return;
      }
      const payload = (await response.json()) as {
        checks?: DependencyCheck[];
        totalLatencyMs?: number;
      };
      setChecks(payload.checks ?? []);
      setTotal(payload.totalLatencyMs ?? null);
    } catch {
      setError('Impossibile contattare la diagnostica.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted">
        Verifica che database, Redis e API del modello rispondano davvero, misurando il tempo di
        andata e ritorno. Sono numeri reali, non stime.
      </p>

      <div className="flex items-center gap-3">
        <Button variant="secondary" onClick={() => void run()} disabled={busy} className="px-3 py-2 text-xs">
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Activity className="size-3.5" aria-hidden="true" />
          )}
          Esegui la diagnostica
        </Button>
        {total !== null && !busy && (
          <span className="text-[11px] tabular-nums text-muted">
            completata in {total} ms
          </span>
        )}
      </div>

      {error !== null && (
        <p role="alert" className="text-[11px] text-danger">
          {error}
        </p>
      )}

      {checks !== null && (
        <ul className="space-y-1.5">
          {checks.map((check) => (
            <li
              key={check.name}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-xs"
            >
              <span className="font-mono text-[11px]">{check.name}</span>
              <Badge tone={STATUS_TONES[check.status]}>{STATUS_LABELS[check.status]}</Badge>
              {check.latencyMs !== null && (
                <span className="tabular-nums text-muted">{check.latencyMs} ms</span>
              )}
              <span className="min-w-0 flex-1 text-[11px] text-muted">{check.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function SignOutButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <Button
      variant="secondary"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch('/api/auth/logout', { method: 'POST' });
        router.refresh();
        router.push('/');
      }}
      className={cn('px-3 py-2 text-xs')}
    >
      <LogOut className="size-3.5" aria-hidden="true" />
      Esci
    </Button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export interface PendingInvite {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly expiresAt: string;
}

/**
 * Invito di colleghi.
 *
 * Le postazioni occupate contano **anche gli inviti aperti**, ed è ciò che il
 * contatore mostra. Senza, qualcuno genererebbe cinque inviti su un piano da
 * cinque posti e scoprirebbe il limite solo quando la quinta persona non riesce
 * a entrare — cioè addossando a lei l'errore di chi l'ha invitata.
 */
export function InvitePanel({
  invites,
  seatsUsed,
  seatsLimit,
  canInvite,
  planName,
}: {
  invites: readonly PendingInvite[];
  seatsUsed: number;
  seatsLimit: number | null;
  canInvite: boolean;
  planName: string;
}) {
  const router = useRouter();
  const emailId = useId();
  const roleId = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [devLink, setDevLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const { save, busy, error, saved } = useSaver();

  const full = seatsLimit !== null && seatsUsed >= seatsLimit;

  const submit = async (): Promise<void> => {
    setDevLink(null);
    setInviteError(null);
    try {
      const response = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const payload = (await response.json()) as {
        message?: string;
        link?: string | null;
        emailDelivered?: boolean;
      };

      if (!response.ok) {
        setInviteError(payload.message ?? 'Invito non riuscito.');
        return;
      }

      setEmail('');
      if (payload.emailDelivered !== true && typeof payload.link === 'string') {
        // Nessun fornitore di posta: il link va consegnato a mano, altrimenti
        // l'invito esiste e non raggiunge nessuno.
        setDevLink(payload.link);
      }
      router.refresh();
    } catch {
      setInviteError('Impossibile contattare il server.');
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">
        {seatsLimit === null
          ? `${seatsUsed} postazioni occupate · piano ${planName}, senza limite`
          : `${seatsUsed} di ${seatsLimit} postazioni occupate, inviti aperti inclusi · piano ${planName}`}
      </p>

      {!canInvite ? (
        <p className="rounded-lg border border-border bg-surface-raised p-3 text-xs leading-relaxed text-muted">
          Solo chi amministra il workspace può invitare nuove persone.
        </p>
      ) : full ? (
        <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-3">
          <p className="text-xs leading-relaxed">
            Tutte le postazioni del piano {planName} sono occupate. Revoca un invito aperto per
            liberarne una, oppure passa a un piano con più posti.
          </p>
          <Link
            href="/pricing"
            className="mt-2 inline-flex text-xs font-medium text-accent underline-offset-2 hover:underline"
          >
            Vedi i piani
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5 sm:flex-row">
          <div className="min-w-0 flex-1">
            <label htmlFor={emailId} className="sr-only">
              Email della persona da invitare
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="collega@azienda.it"
              className="w-full rounded-lg border border-border bg-background px-2.5 py-2 text-xs placeholder:text-muted"
            />
          </div>
          <label htmlFor={roleId} className="sr-only">
            Ruolo
          </label>
          <select
            id={roleId}
            value={role}
            onChange={(event) => setRole(event.target.value)}
            className="rounded-lg border border-border bg-background px-2.5 py-2 text-xs"
          >
            <option value="member">Membro</option>
            <option value="admin">Amministratore</option>
          </select>
          <Button
            onClick={() => void submit()}
            disabled={email.trim().length === 0}
            className="shrink-0 px-3 py-2 text-xs"
          >
            <UserPlus className="size-3.5" aria-hidden="true" />
            Invita
          </Button>
        </div>
      )}

      {inviteError !== null && (
        <p role="alert" className="text-[11px] leading-relaxed text-danger">
          {inviteError}
        </p>
      )}

      {devLink !== null && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-2.5">
          <p className="text-[11px] font-medium text-warning">
            Email non inviata: nessun fornitore di posta configurato
          </p>
          <p className="mt-1 break-all font-mono text-[10px] text-warning/90">{devLink}</p>
          <p className="mt-1 text-[11px] text-warning/90">
            Consegna tu questo link alla persona invitata.
          </p>
        </div>
      )}

      {invites.length > 0 && (
        <ul className="space-y-1.5">
          {invites.map((invite) => (
            <li
              key={invite.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border bg-surface-raised px-2.5 py-2 text-xs"
            >
              <span className="min-w-0 flex-1 truncate">{invite.email}</span>
              <Badge>{invite.role}</Badge>
              <Badge tone="warning">in attesa</Badge>
              <span className="text-[11px] text-muted">
                scade il {new Date(invite.expiresAt).toLocaleDateString('it-IT')}
              </span>
              {canInvite && (
                <button
                  type="button"
                  onClick={() => void save('/api/team/invite', { invitationId: invite.id })}
                  disabled={busy}
                  className="rounded p-1 text-muted transition-colors hover:bg-surface hover:text-danger"
                  aria-label={`Revoca l'invito per ${invite.email}`}
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <Status busy={busy} error={error} saved={saved} />
    </div>
  );
}

/**
 * Gestione dell'abbonamento.
 *
 * Un collegamento al portale ospitato, non un modulo nostro: metodo di
 * pagamento, fatture e disdetta sono flussi con requisiti fiscali che cambiano
 * per giurisdizione, e ricostruirli significa mantenere un secondo prodotto.
 */
export function ManageSubscriptionLink({ hasCustomer }: { hasCustomer: boolean }) {
  if (!hasCustomer) {
    return (
      <p className="text-xs leading-relaxed text-muted">
        Non risultano pagamenti su questo workspace: non c&apos;è ancora un abbonamento da gestire.
      </p>
    );
  }

  return (
    <div>
      <a
        href="/api/billing/portal"
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-xs font-medium transition-colors hover:bg-surface-raised"
      >
        <CreditCard className="size-3.5" aria-hidden="true" />
        Gestisci abbonamento e fatture
      </a>
      <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
        Si apre il portale sicuro di Stripe: da lì cambi il metodo di pagamento, scarichi le
        fatture e disdici. Nessun dato di carta passa dai nostri sistemi.
      </p>
    </div>
  );
}
