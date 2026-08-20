import { ShieldCheck } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AuthForm } from '@/components/auth/auth-form';
import { authUnavailableReason, getCurrentAccount, isAuthAvailable } from '@/lib/auth/current-user';

export const metadata: Metadata = {
  title: 'Accedi',
  description: 'Accedi al tuo workspace OmniAgent Edge.',
};

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  // Chi è già dentro non deve vedere un modulo di accesso: è il modo più rapido
  // per far dubitare qualcuno di essere davvero autenticato.
  if (await getCurrentAccount()) redirect('/history');

  return (
    <div className="mx-auto flex max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="mb-6 text-center">
        <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
          <ShieldCheck className="size-6" aria-hidden="true" />
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">Bentornato</h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          I tuoi audit, la cronologia dei fornitori e i confronti fra versioni ti aspettano dove li
          hai lasciati.
        </p>
      </div>

      <AuthForm mode="login" disabled={!isAuthAvailable()} disabledReason={authUnavailableReason()} />

      {isAuthAvailable() && (
        <p className="mt-3 text-center text-xs text-muted">
          <Link
            href="/forgot-password"
            className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Password dimenticata?
          </Link>
        </p>
      )}
    </div>
  );
}
