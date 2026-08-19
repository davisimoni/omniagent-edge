import { z } from 'zod';
import { checkPasswordStrength, MAX_PASSWORD_LENGTH } from '@/lib/auth/password';
import { createAccount, EmailAlreadyRegisteredError } from '@/lib/auth/repository';
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from '@/lib/auth/session';
import { authUnavailableReason, isAuthAvailable } from '@/lib/auth/current-user';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  workspaceName: z.string().trim().min(2).max(120),
});

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

/**
 * Registrazione.
 *
 * L'utente esce da qui **già autenticato**: chiedere di accedere subito dopo
 * aver creato un account è un passaggio che non aggiunge sicurezza e fa perdere
 * una parte delle persone proprio dopo che hanno deciso di iscriversi.
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

  const parsed = registerSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, {
      error: 'invalid_request',
      message: 'Controlla i campi del modulo.',
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }

  const strength = checkPasswordStrength(parsed.data.password);
  if (!strength.ok) {
    return json(400, { error: 'weak_password', message: strength.message });
  }

  try {
    const { user, organization } = await createAccount(parsed.data);
    const token = await createSessionToken({
      uid: user.id,
      oid: organization.id,
      sv: user.sessionVersion,
    });

    const options = sessionCookieOptions();
    return json(
      201,
      {
        ok: true,
        user: { id: user.id, name: user.name, email: user.email },
        organization: { id: organization.id, name: organization.name, plan: organization.plan },
      },
      {
        'set-cookie':
          `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=${options.maxAge}`,
      },
    );
  } catch (error) {
    if (error instanceof EmailAlreadyRegisteredError) {
      return json(409, { error: 'email_taken', message: error.message });
    }
    console.error('[auth/register] errore', error);
    return json(500, {
      error: 'registration_failed',
      message: 'Non è stato possibile creare l\'account. Riprova fra un momento.',
    });
  }
}
