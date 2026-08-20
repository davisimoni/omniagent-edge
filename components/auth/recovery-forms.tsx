'use client';

import { AlertCircle, ArrowRight, Check, Loader2, Mail } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';

/**
 * Moduli dei flussi di recupero.
 *
 * Il messaggio di conferma è **lo stesso** che l'indirizzo esista o no, e non è
 * una svista: distinguere i due casi permetterebbe di scoprire quali aziende
 * hanno un account qui. Il testo lo dice con onestà — "se esiste un account" —
 * invece di far credere all'utente che l'email sia certamente partita.
 */

function Field({
  id,
  label,
  type = 'text',
  value,
  onChange,
  autoComplete,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required
        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm placeholder:text-muted"
      />
      {hint !== undefined && <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs leading-relaxed text-danger"
    >
      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      {message}
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function ForgotPasswordForm({ disabled }: { disabled: boolean }) {
  const emailId = useId();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<{ message: string; devLink: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || disabled) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/forgot', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const payload = (await response.json()) as {
        message?: string;
        devPreview?: { text?: string } | null;
      };

      if (!response.ok) {
        setError(payload.message ?? 'Richiesta non riuscita.');
        return;
      }

      // In sviluppo, senza fornitore di posta, il link torna nel corpo: senza,
      // il flusso non sarebbe percorribile in locale.
      const link = payload.devPreview?.text?.match(/https?:\/\/\S+/)?.[0] ?? null;
      setSent({ message: payload.message ?? '', devLink: link });
    } catch {
      setError('Impossibile contattare il server.');
    } finally {
      setBusy(false);
    }
  };

  if (sent !== null) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs leading-relaxed text-success">
          <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {sent.message}
        </p>

        {sent.devLink !== null && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            <p className="text-[11px] font-medium text-warning">
              Modalità sviluppo — nessun fornitore di posta configurato
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-warning/90">
              Il link è mostrato qui perché l&apos;email non è stata inviata. In produzione questo
              riquadro non compare mai.
            </p>
            <Link
              href={sent.devLink}
              className="mt-2 inline-block break-all font-mono text-[10px] text-accent underline-offset-2 hover:underline"
            >
              {sent.devLink}
            </Link>
          </div>
        )}

        <Link
          href="/login"
          className="inline-flex text-xs font-medium text-accent underline-offset-2 hover:underline"
        >
          Torna all&apos;accesso
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field
        id={emailId}
        label="Email dell'account"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        placeholder="nome@azienda.it"
      />
      {error !== null && <ErrorNote message={error} />}
      <Button type="submit" disabled={busy || disabled} className="w-full">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Invio in corso…
          </>
        ) : (
          <>
            Inviami il link
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </Button>
      <p className="text-center text-xs text-muted">
        Te la sei ricordata?{' '}
        <Link href="/login" className="font-medium text-accent underline-offset-2 hover:underline">
          Accedi
        </Link>
      </p>
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function ResetPasswordForm({ token, initialError }: { token: string; initialError: string | null }) {
  const router = useRouter();
  const passwordId = useId();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [done, setDone] = useState(false);

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || initialError !== null) return;
    setBusy(true);
    setError(null);

    try {
      const response = await fetch('/api/auth/reset', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        setError(payload.message ?? 'Reimpostazione non riuscita.');
        return;
      }

      setDone(true);
      // Non si entra automaticamente: chi reimposta una password sospetta spesso
      // un accesso altrui, e la prima cosa da verificare è che la nuova funzioni.
      window.setTimeout(() => router.push('/login'), 1800);
    } catch {
      setError('Impossibile contattare il server.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <p className="flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-xs leading-relaxed text-success">
        <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        Password aggiornata. Ogni dispositivo collegato è stato disconnesso. Ti stiamo portando
        alla pagina di accesso…
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <Field
        id={passwordId}
        label="Nuova password"
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete="new-password"
        hint={`Almeno ${MIN_PASSWORD_LENGTH} caratteri. Cambiarla disconnette ogni dispositivo collegato.`}
      />
      {error !== null && <ErrorNote message={error} />}
      <Button type="submit" disabled={busy || initialError !== null} className="w-full">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Aggiornamento…
          </>
        ) : (
          'Imposta la nuova password'
        )}
      </Button>
      {initialError !== null && (
        <p className="text-center text-xs text-muted">
          <Link
            href="/forgot-password"
            className="font-medium text-accent underline-offset-2 hover:underline"
          >
            Richiedi un nuovo link
          </Link>
        </p>
      )}
    </form>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export function AcceptInviteButton({ token }: { token: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/invite/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      const payload = (await response.json()) as { message?: string };

      if (!response.ok) {
        setError(payload.message ?? 'Accettazione non riuscita.');
        return;
      }

      router.refresh();
      router.push('/history');
    } catch {
      setError('Impossibile contattare il server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Button onClick={() => void accept()} disabled={busy} className="w-full">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Ingresso nel workspace…
          </>
        ) : (
          <>
            Accetta l&apos;invito
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </Button>
      {error !== null && <ErrorNote message={error} />}
    </div>
  );
}
