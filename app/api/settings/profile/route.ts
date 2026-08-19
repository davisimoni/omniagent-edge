import { z } from 'zod';
import { getCurrentAccount } from '@/lib/auth/current-user';
import { changePassword, renameOrganization, updateProfile } from '@/lib/auth/repository';
import { checkPasswordStrength, MAX_PASSWORD_LENGTH } from '@/lib/auth/password';
import { SESSION_COOKIE } from '@/lib/auth/session';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const profileSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  workspaceName: z.string().trim().min(2).max(120).optional(),
  newPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH).optional(),
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * Aggiornamento di profilo e workspace.
 *
 * Il cambio password **disconnette ovunque**, questa sessione compresa:
 * `changePassword` incrementa `session_version` e da quel momento ogni token
 * emesso prima smette di valere. È il comportamento che ci si aspetta dopo un
 * "credo che qualcuno abbia la mia password" — lasciare valide le altre sessioni
 * renderebbe il cambio password una formalità. Il cookie viene quindi svuotato
 * nella risposta, così l'utente rifà l'accesso invece di trovarsi in uno stato
 * in cui la pagina sembra funzionare e ogni azione fallisce.
 */
export async function PATCH(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return json(401, { error: 'unauthenticated', message: 'Sessione non valida.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Controlla i campi inseriti.' });
  }

  try {
    if (parsed.data.name !== undefined) {
      await updateProfile(account.user.id, parsed.data.name);
    }

    if (parsed.data.workspaceName !== undefined) {
      if (account.role === 'member') {
        return json(403, {
          error: 'forbidden',
          message: 'Solo chi amministra il workspace può rinominarlo.',
        });
      }
      await renameOrganization(account.organization.id, parsed.data.workspaceName);
    }

    if (parsed.data.newPassword !== undefined) {
      const strength = checkPasswordStrength(parsed.data.newPassword);
      if (!strength.ok) return json(400, { error: 'weak_password', message: strength.message });

      await changePassword(account.user.id, parsed.data.newPassword);
      return json(
        200,
        { ok: true, signedOut: true, message: 'Password aggiornata. Accedi di nuovo.' },
        { 'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0` },
      );
    }

    return json(200, { ok: true, signedOut: false });
  } catch (error) {
    console.error('[settings/profile] errore', error);
    return json(500, { error: 'update_failed', message: 'Aggiornamento non riuscito.' });
  }
}
