import { z } from 'zod';
import { getCurrentAccount } from '@/lib/auth/current-user';
import { acceptInvitation } from '@/lib/auth/invitations';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { loadAccount } from '@/lib/auth/repository';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const acceptSchema = z.object({ token: z.string().min(10).max(200) });

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

const FAILURE_MESSAGES = {
  invalid: 'Questo invito non è più valido: potrebbe essere scaduto o già stato usato.',
  seats_exhausted:
    'Il workspace ha esaurito le postazioni del proprio piano. Chiedi a chi lo amministra di liberarne una o di passare a un piano superiore.',
  already_member: 'Fai già parte di questo workspace.',
} as const;

/**
 * Accettazione di un invito.
 *
 * Richiede un utente già autenticato: chi arriva dal link senza account passa
 * prima dalla registrazione, e torna qui dopo. Legare la creazione dell'account
 * all'accettazione in un'unica operazione sembra più comodo e nasconde un
 * problema — l'invito è indirizzato a un'email, e senza un passaggio di
 * registrazione esplicito nulla garantisce che chi clicca sia il destinatario.
 *
 * Alla riuscita la sessione viene **riemessa** sulla nuova organizzazione: il
 * cookie porta l'organizzazione attiva, e senza riemetterlo l'utente resterebbe
 * a guardare il workspace precedente dopo aver accettato.
 */
export async function POST(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return json(401, {
      error: 'unauthenticated',
      message: 'Accedi o crea un account per accettare l\'invito.',
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = acceptSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Invito non indicato.' });
  }

  try {
    const result = await acceptInvitation(parsed.data.token, account.user.id);
    if (!result.ok) {
      const reason = result.reason ?? 'invalid';
      return json(reason === 'seats_exhausted' ? 402 : 400, {
        error: reason,
        message: FAILURE_MESSAGES[reason],
      });
    }

    const organizationId = result.organizationId;
    if (organizationId === null) {
      return json(500, { error: 'accept_failed', message: 'Accettazione non riuscita.' });
    }

    const updated = await loadAccount(account.user.id, organizationId, account.user.sessionVersion);
    if (updated === null) {
      return json(500, { error: 'accept_failed', message: 'Accettazione non riuscita.' });
    }

    const token = await createSessionToken({
      uid: updated.user.id,
      oid: organizationId,
      sv: updated.user.sessionVersion,
    });
    const options = sessionCookieOptions();

    return json(
      200,
      { ok: true, organization: { id: organizationId, name: updated.organization.name } },
      {
        'set-cookie':
          `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${options.maxAge}`,
      },
    );
  } catch (error) {
    console.error('[invite/accept] errore', error);
    return json(500, { error: 'accept_failed', message: 'Accettazione non riuscita.' });
  }
}
