import { z } from 'zod';
import { authenticate } from '@/lib/auth/repository';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { authUnavailableReason, isAuthAvailable } from '@/lib/auth/current-user';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(200),
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * Accesso.
 *
 * Un solo messaggio di errore per credenziali sbagliate, senza distinguere
 * "email inesistente" da "password errata". La distinzione aiuta l'utente
 * distratto e aiuta altrettanto chi vuole sapere quali indirizzi hanno un
 * account qui — che in un prodotto B2B equivale all'elenco dei clienti.
 *
 * Il limitatore di richieste sul percorso `/api` copre anche questa rotta: senza,
 * sarebbe il punto naturale da cui provare password in sequenza.
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

  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Inserisci email e password.' });
  }

  try {
    const account = await authenticate(parsed.data.email, parsed.data.password);
    if (account === null) {
      return json(401, {
        error: 'invalid_credentials',
        message: 'Email o password non corretti.',
      });
    }

    const token = await createSessionToken({
      uid: account.user.id,
      oid: account.organization.id,
      sv: account.user.sessionVersion,
    });
    const options = sessionCookieOptions();

    return json(
      200,
      {
        ok: true,
        user: { id: account.user.id, name: account.user.name, email: account.user.email },
        organization: {
          id: account.organization.id,
          name: account.organization.name,
          plan: account.organization.plan,
        },
      },
      {
        'set-cookie':
          `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${options.maxAge}`,
      },
    );
  } catch (error) {
    console.error('[auth/login] errore', error);
    return json(500, {
      error: 'login_failed',
      message: 'Accesso non riuscito. Riprova fra un momento.',
    });
  }
}
