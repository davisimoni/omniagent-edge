import { SESSION_COOKIE } from '@/lib/auth/session';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

/**
 * Uscita.
 *
 * POST e non GET: un `<img src="/api/auth/logout">` su una pagina qualsiasi
 * disconnetterebbe chiunque la visiti. È un fastidio, non una compromissione,
 * ma costa zero evitarlo.
 *
 * Il cookie viene sovrascritto con `Max-Age=0`. Il token resta tecnicamente
 * valido fino alla scadenza — è il prezzo delle sessioni senza stato — e per
 * invalidarlo davvero serve il cambio password, che incrementa `session_version`.
 */
export function POST(): Response {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'set-cookie': `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Secure; Path=/; Max-Age=0`,
    },
  });
}
