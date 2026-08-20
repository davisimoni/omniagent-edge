import { getCurrentAccount } from '@/lib/auth/current-user';
import { createPortalSession, isStripeConfigured, StripeNotConfiguredError } from '@/lib/billing/stripe';
import { readEnv } from '@/lib/env';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Portale clienti Stripe.
 *
 * Da qui si cambia il metodo di pagamento, si scaricano le fatture e si disdice.
 * È la rotta che rende vera la frase "disdici quando vuoi" nelle condizioni di
 * servizio: finché non esisteva, quella riga era una promessa che il prodotto
 * non manteneva.
 *
 * **Il cliente Stripe si legge dal database, non dalla richiesta.** Se arrivasse
 * dal client, sostituire un identificativo aprirebbe il portale di fatturazione
 * di un altro cliente — con le sue fatture, il suo indirizzo e la sua carta.
 */
export async function GET(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return Response.redirect(new URL('/login', request.url), 302);
  }

  if (!isStripeConfigured()) {
    return json(503, {
      error: 'stripe_not_configured',
      message: 'La gestione dell\'abbonamento non è attiva su questa installazione.',
    });
  }

  const customerId = account.organization.stripeCustomerId;
  if (customerId === null || customerId.length === 0) {
    // Nessun cliente Stripe: non c'è mai stato un pagamento, quindi non c'è
    // nulla da gestire. Si manda al listino invece di mostrare un errore, che
    // sarebbe tecnicamente corretto e inutile per chi lo legge.
    return Response.redirect(new URL('/pricing', request.url), 302);
  }

  const origin = readEnv('NEXT_PUBLIC_APP_URL') ?? new URL(request.url).origin;

  try {
    const session = await createPortalSession({
      customerId,
      returnUrl: `${origin}/settings`,
    });
    return Response.redirect(session.url, 303);
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      return json(503, { error: error.code, message: error.message });
    }
    console.error('[billing/portal] errore', error);
    return json(502, {
      error: 'portal_failed',
      message: 'Non è stato possibile aprire la gestione dell\'abbonamento. Riprova fra un momento.',
    });
  }
}
