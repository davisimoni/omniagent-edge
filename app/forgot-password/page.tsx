import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import { ForgotPasswordForm } from '@/components/auth/recovery-forms';
import { authUnavailableReason, isAuthAvailable } from '@/lib/auth/current-user';

export const metadata: Metadata = {
  title: 'Password dimenticata',
  description: 'Richiedi un link per reimpostare la password del tuo account.',
};

export const dynamic = 'force-dynamic';

export default function ForgotPasswordPage() {
  const available = isAuthAvailable();

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-6 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <KeyRound className="size-5" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Reimposta la password</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Inserisci l&apos;indirizzo con cui ti sei registrato: ti mandiamo un link valido
          un&apos;ora. I tuoi audit restano dove sono.
        </p>
      </div>

      {available ? (
        <ForgotPasswordForm disabled={false} />
      ) : (
        <p
          role="status"
          className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-warning"
        >
          {authUnavailableReason()}
        </p>
      )}
    </div>
  );
}
