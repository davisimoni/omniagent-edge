import { readEnv } from '@/lib/env';
import { isDatabaseConfigured } from '@/lib/db/client';
import { applySubscriptionChange } from '@/lib/billing/repository';
import { parseSubscriptionEvent, verifyWebhookSignature } from '@/lib/billing/stripe';

/**
 * Webhook Stripe.
 *
 * **Fail-closed sul segreto.** Senza `STRIPE_WEBHOOK_SECRET` la rotta risponde
 * 503 a chiunque, invece di accettare eventi non firmati. Un endpoint che
 * applica cambi di piano senza verificare la firma è un'API pubblica che
 * concede abbonamenti: chi ne scopre l'URL si attiva il piano Pro con una POST.
 *
 * **Il corpo si legge grezzo.** `request.text()` e mai `request.json()`: la
 * firma è calcolata sui byte esatti che Stripe ha spedito, e un giro di
 * deserializzazione e riserializzazione cambia spaziatura e ordine delle
 * chiavi — a quel punto nessuna firma legittima tornerebbe più.
 */
export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const secret = readEnv('STRIPE_WEBHOOK_SECRET');
  if (secret === undefined) {
    return json(503, {
      error: 'webhook_not_configured',
      message: 'STRIPE_WEBHOOK_SECRET non configurata: gli eventi non possono essere verificati.',
    });
  }

  if (!isDatabaseConfigured()) {
    // 503 e non 200: Stripe ritenta, e quando il database tornerà disponibile
    // l'evento verrà applicato invece di essere perso in silenzio.
    return json(503, {
      error: 'database_unavailable',
      message: 'Database non configurato: impossibile applicare l\'evento.',
    });
  }

  const rawBody = await request.text();
  const verification = await verifyWebhookSignature(
    rawBody,
    request.headers.get('stripe-signature'),
    secret,
  );

  if (!verification.valid) {
    console.warn('[webhooks/stripe] firma rifiutata', verification.reason);
    return json(400, { error: 'invalid_signature', message: 'Firma non valida.' });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: 'invalid_json', message: 'Corpo non decodificabile.' });
  }

  const change = parseSubscriptionEvent(payload);
  if (change === null) {
    // Evento non gestito: si conferma la ricezione. Un errore farebbe ritentare
    // a Stripe una consegna che non abbiamo motivo di rifiutare, e riempirebbe
    // i log di rumore fino a nascondere gli eventi che contano.
    return json(200, { received: true, handled: false });
  }

  try {
    const result = await applySubscriptionChange(change);
    if (!result.applied) {
      console.warn('[webhooks/stripe] evento non riconciliato', {
        type: change.type,
        reason: result.reason,
      });
    }
    return json(200, { received: true, handled: result.applied });
  } catch (error) {
    console.error('[webhooks/stripe] applicazione fallita', error);
    // 500: Stripe ritenta con backoff, ed è ciò che vogliamo per un guasto
    // temporaneo del database.
    return json(500, { error: 'apply_failed', message: 'Evento non applicato.' });
  }
}
