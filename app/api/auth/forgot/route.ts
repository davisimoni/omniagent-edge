import { z } from 'zod';
import { authUnavailableReason, isAuthAvailable } from '@/lib/auth/current-user';
import { requestPasswordReset } from '@/lib/auth/password-reset';
import { readEnv } from '@/lib/env';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const forgotSchema = z.object({ email: z.string().trim().email().max(254) });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Richiesta di reimpostazione password.
 *
 * **Risponde sempre allo stesso modo.** Che l'indirizzo sia registrato o no, il
 * corpo della risposta è identico: la differenza permetterebbe di enumerare gli
 * account, cioè di scoprire quali aziende usano questo servizio — informazione
 * commercialmente sensibile in un prodotto B2B.
 *
 * L'unica eccezione è il riquadro di sviluppo: senza fornitore di posta e fuori
 * produzione, il link torna nella risposta perché altrimenti il flusso non
 * sarebbe percorribile in locale. In produzione quel ramo è spento — restituire
 * il link a chiunque conosca un'email sarebbe consegnare l'account.
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

  const parsed = forgotSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Inserisci un indirizzo email valido.' });
  }

  const origin = readEnv('NEXT_PUBLIC_APP_URL') ?? new URL(request.url).origin;

  try {
    const outcome = await requestPasswordReset(parsed.data.email, origin);

    return json(200, {
      ok: true,
      message:
        'Se esiste un account con questo indirizzo, riceverai un link per reimpostare la password. ' +
        'Controlla anche la posta indesiderata.',
      // Presente solo in sviluppo e senza fornitore di posta configurato.
      devPreview: outcome.email?.devPreview ?? null,
    });
  } catch (error) {
    console.error('[auth/forgot] errore', error);
    // Anche l'errore non distingue i casi: un 500 solo sugli indirizzi noti
    // sarebbe a sua volta un canale di enumerazione.
    return json(200, {
      ok: true,
      message:
        'Se esiste un account con questo indirizzo, riceverai un link per reimpostare la password.',
      devPreview: null,
    });
  }
}
