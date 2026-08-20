import { z } from 'zod';
import { authUnavailableReason, isAuthAvailable } from '@/lib/auth/current-user';
import { checkPasswordStrength, MAX_PASSWORD_LENGTH } from '@/lib/auth/password';
import { consumeReset, RESET_FAILURE_MESSAGES } from '@/lib/auth/password-reset';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const resetSchema = z.object({
  token: z.string().min(10).max(200),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * Reimpostazione della password.
 *
 * L'utente **non** esce da qui autenticato, a differenza della registrazione. È
 * deliberato: chi reimposta una password lo fa spesso perché sospetta che
 * qualcuno vi abbia avuto accesso, e la prima cosa da verificare è che la nuova
 * password funzioni davvero. Il cambio invalida ogni sessione aperta — inclusa
 * quella di chi si fosse introdotto — e il cookie viene svuotato qui perché non
 * resti uno stato in cui la pagina sembra funzionare e ogni azione fallisce.
 */
export async function POST(request: Request): Promise<Response> {
  if (!isAuthAvailable()) {
    return json(503, { error: 'auth_unavailable', message: authUnavailableReason() });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = resetSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Richiesta non valida.' });
  }

  const strength = checkPasswordStrength(parsed.data.password);
  if (!strength.ok) return json(400, { error: 'weak_password', message: strength.message });

  try {
    const outcome = await consumeReset(parsed.data.token, parsed.data.password);
    if (!outcome.ok) {
      return json(400, {
        error: `reset_${outcome.reason ?? 'invalid'}`,
        message: RESET_FAILURE_MESSAGES[outcome.reason ?? 'invalid'],
      });
    }

    return json(
      200,
      { ok: true, message: 'Password aggiornata. Accedi con quella nuova.' },
      { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0` },
    );
  } catch (error) {
    console.error('[auth/reset] errore', error);
    return json(500, {
      error: 'reset_failed',
      message: 'Non è stato possibile aggiornare la password. Riprova fra un momento.',
    });
  }
}
