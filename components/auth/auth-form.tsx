'use client';

import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/primitives';
import { MIN_PASSWORD_LENGTH } from '@/lib/auth/password';
import { cn } from '@/lib/utils';

/**
 * Modulo di accesso e registrazione.
 *
 * Un solo componente per entrambi: i due moduli differiscono per due campi e
 * per una etichetta, e tenerli separati significherebbe correggere due volte
 * ogni dettaglio di accessibilità — l'associazione `label`/`id`, la gestione
 * dell'errore, il blocco del doppio invio.
 *
 * **Gli errori restano vicini al campo e in testo, non solo in colore.** Un
 * bordo rosso non dice che cosa è andato storto, e per chi non distingue i
 * colori non dice nemmeno che qualcosa è andato storto.
 */

export type AuthMode = 'login' | 'register';

export function AuthForm({
  mode,
  disabled,
  disabledReason,
}: {
  mode: AuthMode;
  disabled: boolean;
  disabledReason: string | null;
}) {
  const router = useRouter();
  const nameId = useId();
  const workspaceId = useId();
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  const [name, setName] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRegister = mode === 'register';

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy || disabled) return;

    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(
          isRegister ? { name, workspaceName, email, password } : { email, password },
        ),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        const message =
          typeof payload === 'object' && payload !== null && 'message' in payload
            ? String((payload as { message: unknown }).message)
            : 'Non è stato possibile completare l\'operazione.';
        setError(message);
        return;
      }

      // `refresh()` prima di `push()`: il server component dell'intestazione
      // deve rileggere la sessione, altrimenti si atterra sulla pagina nuova
      // con la barra ancora in stato disconnesso.
      router.refresh();
      router.push(isRegister ? '/audit' : '/history');
    } catch {
      setError('Impossibile contattare il server. Verifica la connessione e riprova.');
    } finally {
      setBusy(false);
    }
  };

  if (disabled) {
    return (
      <div
        role="status"
        className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-warning"
      >
        <p className="font-medium">Gli account non sono disponibili su questa installazione</p>
        <p className="mt-1 opacity-90">{disabledReason}</p>
        <p className="mt-2 text-xs opacity-80">
          Puoi comunque usare l&apos;audit senza account: l&apos;analisi funziona per intero, ma il
          report non viene archiviato.
        </p>
        <Link
          href="/audit"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium underline-offset-2 hover:underline"
        >
          Vai all&apos;audit
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {isRegister && (
        <>
          <Field
            id={nameId}
            label="Come ti chiami"
            value={name}
            onChange={setName}
            autoComplete="name"
            placeholder="Giulia Bianchi"
            required
          />
          <Field
            id={workspaceId}
            label="Nome del workspace"
            hint="Di solito il nome della tua azienda o del tuo studio."
            value={workspaceName}
            onChange={setWorkspaceName}
            autoComplete="organization"
            placeholder="Delta Energia"
            required
          />
        </>
      )}

      <Field
        id={emailId}
        label="Email di lavoro"
        type="email"
        value={email}
        onChange={setEmail}
        autoComplete="email"
        placeholder="nome@azienda.it"
        required
      />

      <Field
        id={passwordId}
        label="Password"
        hint={
          isRegister
            ? `Almeno ${MIN_PASSWORD_LENGTH} caratteri. Una frase che ricordi vale più di una parola con i simboli.`
            : undefined
        }
        type="password"
        value={password}
        onChange={setPassword}
        autoComplete={isRegister ? 'new-password' : 'current-password'}
        required
        describedBy={error !== null ? errorId : undefined}
      />

      {error !== null && (
        <p
          id={errorId}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-2.5 text-xs leading-relaxed text-danger"
        >
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      <Button type="submit" disabled={busy} className="w-full">
        {busy ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            {isRegister ? 'Creazione in corso…' : 'Accesso in corso…'}
          </>
        ) : (
          <>
            {isRegister ? 'Crea il workspace' : 'Accedi'}
            <ArrowRight className="size-4" aria-hidden="true" />
          </>
        )}
      </Button>

      <p className="text-center text-xs text-muted">
        {isRegister ? (
          <>
            Hai già un account?{' '}
            <Link href="/login" className="font-medium text-accent underline-offset-2 hover:underline">
              Accedi
            </Link>
          </>
        ) : (
          <>
            Non hai ancora un account?{' '}
            <Link
              href="/register"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              Creane uno gratis
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

function Field({
  id,
  label,
  hint,
  type = 'text',
  value,
  onChange,
  autoComplete,
  placeholder,
  required,
  describedBy,
}: {
  id: string;
  label: string;
  hint?: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
  describedBy?: string;
}) {
  const hintId = `${id}-hint`;
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
        required={required}
        aria-describedby={[hint !== undefined ? hintId : null, describedBy]
          .filter((entry): entry is string => entry !== null && entry !== undefined)
          .join(' ') || undefined}
        className={cn(
          'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm',
          'placeholder:text-muted',
        )}
      />
      {hint !== undefined && (
        <p id={hintId} className="mt-1 text-[11px] leading-relaxed text-muted">
          {hint}
        </p>
      )}
    </div>
  );
}
