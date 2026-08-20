import { ArrowRight, MailX, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AcceptInviteButton } from '@/components/auth/recovery-forms';
import { Badge } from '@/components/ui/primitives';
import { authUnavailableReason, getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';
import { previewInvitation } from '@/lib/auth/invitations';

export const metadata: Metadata = { title: 'Invito al workspace', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Accettazione di un invito.
 *
 * Tre stati distinti, perché portano a tre azioni diverse: invito non valido,
 * invito valido ma utente non autenticato, invito valido e utente pronto. Il
 * secondo è il più delicato — chi arriva da una mail non ha necessariamente un
 * account, e mandarlo a una pagina di accesso senza spiegare perché è il punto
 * in cui la maggior parte delle persone abbandona.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!isAuthAvailable()) {
    return (
      <Shell>
        <p className="text-sm leading-relaxed text-muted">{authUnavailableReason()}</p>
      </Shell>
    );
  }

  const invitation = await previewInvitation(token).catch(() => null);

  if (invitation === null) {
    return (
      <Shell>
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl border border-border bg-surface-raised text-muted">
          <MailX className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Invito non più valido</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Il link è scaduto, è già stato usato, oppure è stato revocato. Gli inviti valgono sette
          giorni: chiedi a chi ti ha invitato di mandartene uno nuovo.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium text-accent underline-offset-2 hover:underline"
        >
          Vai alla home
        </Link>
      </Shell>
    );
  }

  const account = await getCurrentAccount();

  return (
    <Shell>
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
        <Users className="size-5" aria-hidden="true" />
      </span>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        {invitation.invitedByName !== null
          ? `${invitation.invitedByName} ti invita in ${invitation.organizationName}`
          : `Invito in ${invitation.organizationName}`}
      </h1>

      <p className="mt-2 text-sm leading-relaxed text-muted">
        Entrando nel workspace vedrai la cronologia degli audit dei fornitori, i punteggi di
        rischio e le revisioni assegnate alla squadra.
      </p>

      <p className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        <Badge>{invitation.email}</Badge>
        <Badge tone="accent">ruolo: {invitation.role}</Badge>
      </p>

      <div className="mt-6 text-left">
        {account !== null ? (
          <>
            {/* Se l'invito è per un altro indirizzo, dirlo prima: accettare con
                l'account sbagliato è recuperabile ma confonde, e la persona non
                capirebbe perché il workspace non è quello che si aspettava. */}
            {account.user.email !== invitation.email && (
              <p className="mb-3 rounded-lg border border-warning/30 bg-warning/10 p-2.5 text-xs leading-relaxed text-warning">
                Sei collegato come <strong>{account.user.email}</strong>, ma l&apos;invito è
                indirizzato a <strong>{invitation.email}</strong>. Puoi comunque accettarlo con
                questo account.
              </p>
            )}
            <AcceptInviteButton token={token} />
          </>
        ) : (
          <div className="space-y-2.5">
            <p className="text-center text-xs leading-relaxed text-muted">
              Per accettare serve un account. Se non ne hai uno, creane uno con{' '}
              <strong className="text-foreground">{invitation.email}</strong>: torna qui subito
              dopo e l&apos;invito sarà ancora valido.
            </p>
            <Link
              href="/register"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
            >
              Crea un account
              <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
            <Link
              href="/login"
              className="inline-flex w-full items-center justify-center rounded-lg border border-border px-4 py-2.5 text-sm font-medium transition-colors hover:bg-surface-raised"
            >
              Ho già un account
            </Link>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-14 text-center sm:px-6">
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">{children}</div>
    </div>
  );
}
