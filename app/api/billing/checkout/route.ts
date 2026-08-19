import { getCurrentAccount } from '@/lib/auth/current-user';
import { createCheckoutSession, isStripeConfigured, StripeNotConfiguredError } from '@/lib/billing/stripe';
import { readEnv } from '@/lib/env';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

/**
 * Avvio del pagamento.
 *
 * Il **piano non arriva dal client**. Un corpo con `{"plan":"pro"}` sarebbe una
 * richiesta che l'utente può riscrivere, e qui il piano determina il prezzo:
 * l'unico piano acquistabile è quello configurato lato server, e l'unico dato
 * che il client fornisce è l'intenzione di pagare.
 *
 * GET e non POST perché è il bersaglio di un link nella pagina prezzi: la
 * risposta è un reindirizzamento verso Stripe, non una mutazione dei nostri dati
 * — la sessione la crea Stripe, e noi non scriviamo nulla finché non arriva il
 * webhook firmato.
 */
export async function GET(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return Response.redirect(new URL('/login', request.url), 302);
  }

  if (!isStripeConfigured()) {
    return new Response(
      JSON.stringify({
        error: 'stripe_not_configured',
        message: 'Il pagamento non è attivo su questa installazione.',
      }),
      { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }

  const origin = readEnv('NEXT_PUBLIC_APP_URL') ?? new URL(request.url).origin;

  try {
    const session = await createCheckoutSession({
      plan: 'pro',
      organizationId: account.organization.id,
      customerEmail: account.user.email,
      successUrl: `${origin}/settings?checkout=success`,
      cancelUrl: `${origin}/pricing?checkout=cancelled`,
      existingCustomerId: account.organization.stripeCustomerId,
    });

    return Response.redirect(session.url, 303);
  } catch (error) {
    if (error instanceof StripeNotConfiguredError) {
      return new Response(
        JSON.stringify({ error: error.code, message: error.message }),
        { status: 503, headers: { 'content-type': 'application/json' } },
      );
    }
    console.error('[billing/checkout] errore', error);
    return new Response(
      JSON.stringify({
        error: 'checkout_failed',
        message: 'Non è stato possibile avviare il pagamento. Riprova fra un momento.',
      }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
}
