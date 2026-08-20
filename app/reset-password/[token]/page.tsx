import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import { ResetPasswordForm } from '@/components/auth/recovery-forms';
import { authUnavailableReason, isAuthAvailable } from '@/lib/auth/current-user';
import { checkResetToken, RESET_FAILURE_MESSAGES } from '@/lib/auth/password-reset';

export const metadata: Metadata = { title: 'Nuova password', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * Scelta della nuova password.
 *
 * Il token viene verificato **prima** di mostrare il modulo: un link scaduto
 * deve dirlo subito, non dopo che l'utente ha scelto e scritto una password
 * nuova. Accoglierla e poi rifiutarla è il modo più efficace per fargli credere
 * di aver sbagliato lui.
 */
export default async function ResetPasswordPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!isAuthAvailable()) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center sm:px-6">
        <p className="text-sm leading-relaxed text-muted">{authUnavailableReason()}</p>
      </div>
    );
  }

  const check = await checkResetToken(token).catch(() => ({ ok: false, reason: 'invalid' as const }));
  const initialError = check.ok ? null : RESET_FAILURE_MESSAGES[check.reason ?? 'invalid'];

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-6 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Scegli una nuova password</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Una frase lunga che ricordi è più sicura di una parola breve con i simboli.
        </p>
      </div>

      <ResetPasswordForm token={token} initialError={initialError} />
    </div>
  );
}
