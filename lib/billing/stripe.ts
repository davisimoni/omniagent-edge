import { readEnv } from '@/lib/env';
import { PLANS, type PlanId } from '@/lib/billing/plans';

/**
 * Integrazione Stripe via REST.
 *
 * **Perché non il pacchetto ufficiale.** Servono due sole operazioni — creare
 * una sessione di Checkout e verificare la firma di un webhook — e il pacchetto
 * `stripe` porterebbe centinaia di kilobyte in un bundle Edge per due chiamate
 * HTTP e una HMAC. La stessa scelta già fatta per Upstash: si parla il
 * protocollo, si testa iniettando `fetch`, e non si aggiunge una dipendenza al
 * percorso più sensibile alla latenza dell'applicazione.
 *
 * **Nessun dato di carta transita da qui.** Il Checkout è ospitato da Stripe:
 * noi creiamo la sessione e reindirizziamo. In archivio restano solo
 * riferimenti opachi (`stripe_customer_id`, `stripe_subscription_id`), mai un
 * numero, un CVV o un token di pagamento.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export function isStripeConfigured(): boolean {
  return readEnv('STRIPE_SECRET_KEY') !== undefined;
}

export function isWebhookConfigured(): boolean {
  return readEnv('STRIPE_WEBHOOK_SECRET') !== undefined;
}

/** Identificativo del prezzo per un piano; `null` se non configurato. */
export function priceIdFor(plan: PlanId): string | null {
  if (plan === 'pro') return readEnv('STRIPE_PRICE_PRO') ?? null;
  return null;
}

export class StripeNotConfiguredError extends Error {
  readonly code = 'stripe_not_configured';
  constructor(missing: string) {
    super(`${missing} non è configurata: il pagamento non può essere avviato.`);
    this.name = 'StripeNotConfiguredError';
  }
}

export interface CheckoutInput {
  readonly plan: PlanId;
  readonly organizationId: string;
  readonly customerEmail: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly existingCustomerId?: string | null;
  readonly fetchImpl?: typeof fetch;
}

export interface CheckoutSession {
  readonly id: string;
  readonly url: string;
}

/**
 * Crea una sessione di Checkout.
 *
 * `client_reference_id` porta l'id dell'organizzazione fino al webhook: senza,
 * alla conferma del pagamento sapremmo che *qualcuno* ha pagato ma non quale
 * workspace attivare. È l'unico filo che lega l'evento Stripe ai nostri dati, e
 * viaggia anche in `metadata` perché i due campi compaiono in eventi diversi.
 */
export async function createCheckoutSession(input: CheckoutInput): Promise<CheckoutSession> {
  const secretKey = readEnv('STRIPE_SECRET_KEY');
  if (secretKey === undefined) throw new StripeNotConfiguredError('STRIPE_SECRET_KEY');

  const priceId = priceIdFor(input.plan);
  if (priceId === null) {
    throw new StripeNotConfiguredError(`STRIPE_PRICE_${input.plan.toUpperCase()}`);
  }

  const body = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.organizationId,
    'metadata[organization_id]': input.organizationId,
    'metadata[plan]': input.plan,
    'subscription_data[metadata][organization_id]': input.organizationId,
    // La fatturazione è per abbonamento e l'imposta la calcola Stripe: gestirla
    // noi significherebbe mantenere aliquote per giurisdizione, cioè un secondo
    // prodotto.
    'automatic_tax[enabled]': 'true',
  });

  if (input.existingCustomerId !== undefined && input.existingCustomerId !== null) {
    body.set('customer', input.existingCustomerId);
  } else {
    body.set('customer_email', input.customerEmail);
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${STRIPE_API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
      // Chiave di idempotenza: un doppio clic sul pulsante non deve creare due
      // sessioni, e quindi due abbonamenti, per lo stesso workspace.
      'idempotency-key': `checkout_${input.organizationId}_${input.plan}_${Math.floor(Date.now() / 60_000)}`,
    },
    body,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    // Il corpo di errore di Stripe può contenere identificativi interni: resta
    // nei log, non nella risposta all'utente.
    console.error('[stripe] creazione sessione fallita', response.status, detail.slice(0, 500));
    throw new Error(`Stripe ha risposto ${response.status} alla creazione della sessione.`);
  }

  const payload = (await response.json()) as { id?: string; url?: string };
  if (typeof payload.id !== 'string' || typeof payload.url !== 'string') {
    throw new Error('Stripe non ha restituito un URL di pagamento.');
  }

  return { id: payload.id, url: payload.url };
}

/**
 * Sessione del portale clienti.
 *
 * **Perché il portale ospitato invece di schermate nostre.** Cambiare metodo di
 * pagamento, scaricare una fattura e disdire sono tre flussi con requisiti
 * fiscali e normativi che cambiano per giurisdizione: ricostruirli significa
 * mantenere un secondo prodotto, e sbagliarli significa che qualcuno non riesce
 * a disdire — che è il modo più rapido di trasformare un cliente in una
 * contestazione con l'emittente della carta.
 *
 * Richiede un `stripe_customer_id`: esiste solo dopo il primo pagamento andato a
 * buon fine, quindi il chiamante deve gestire il caso in cui manchi invece di
 * mostrare un pulsante che porta a un errore.
 */
export async function createPortalSession(input: {
  customerId: string;
  returnUrl: string;
  fetchImpl?: typeof fetch;
}): Promise<{ url: string }> {
  const secretKey = readEnv('STRIPE_SECRET_KEY');
  if (secretKey === undefined) throw new StripeNotConfiguredError('STRIPE_SECRET_KEY');

  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${STRIPE_API}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${secretKey}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ customer: input.customerId, return_url: input.returnUrl }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    console.error('[stripe] portale clienti non creato', response.status, detail.slice(0, 500));
    throw new Error(`Stripe ha risposto ${response.status} alla creazione del portale.`);
  }

  const payload = (await response.json()) as { url?: string };
  if (typeof payload.url !== 'string') {
    throw new Error('Stripe non ha restituito un URL per il portale clienti.');
  }
  return { url: payload.url };
}

// ─────────────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────────────

/** Tolleranza sul timestamp firmato, in secondi. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

function parseSignatureHeader(header: string): { timestamp: number; signatures: string[] } | null {
  const parts = header.split(',');
  let timestamp: number | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split('=');
    if (key === undefined || value === undefined) continue;
    if (key.trim() === 't') timestamp = Number.parseInt(value.trim(), 10);
    if (key.trim() === 'v1') signatures.push(value.trim());
  }

  if (timestamp === null || !Number.isFinite(timestamp) || signatures.length === 0) return null;
  return { timestamp, signatures };
}

async function hmacHex(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

/**
 * Verifica la firma di un webhook.
 *
 * Senza questa verifica l'endpoint è un'API pubblica che accetta "l'abbonamento
 * è attivo" da chiunque conosca l'URL: chi lo scopre si attiva il piano Pro con
 * una richiesta POST. Il controllo sul timestamp chiude il replay — una
 * richiesta legittima intercettata e rispedita più tardi.
 *
 * **La firma si calcola sul corpo grezzo.** Deserializzare e riserializzare il
 * JSON cambia spazi e ordine delle chiavi, e la firma non torna più: la rotta
 * deve leggere il testo con `request.text()`, mai con `request.json()`.
 */
export async function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  now: number = Date.now(),
): Promise<{ valid: boolean; reason: string | null }> {
  if (signatureHeader === null || signatureHeader.length === 0) {
    return { valid: false, reason: 'Header Stripe-Signature assente.' };
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (parsed === null) return { valid: false, reason: 'Header Stripe-Signature malformato.' };

  const age = Math.abs(Math.floor(now / 1000) - parsed.timestamp);
  if (age > WEBHOOK_TOLERANCE_SECONDS) {
    return { valid: false, reason: 'Firma scaduta: possibile replay.' };
  }

  const expected = await hmacHex(secret, `${parsed.timestamp}.${rawBody}`);
  const matches = parsed.signatures.some((signature) => timingSafeEqualHex(signature, expected));
  return matches ? { valid: true, reason: null } : { valid: false, reason: 'Firma non valida.' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Eventi
// ─────────────────────────────────────────────────────────────────────────────

export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.updated',
  'customer.subscription.deleted',
] as const;
export type HandledEvent = (typeof HANDLED_EVENTS)[number];

export interface SubscriptionChange {
  readonly type: HandledEvent;
  readonly organizationId: string | null;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly plan: PlanId;
  readonly status: string;
  readonly currentPeriodEnd: string | null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Riduce un evento Stripe alla sola forma che ci interessa.
 *
 * Restituisce `null` per gli eventi non gestiti: Stripe ne invia decine e
 * trattarli tutti come errori riempirebbe i log di rumore, oltre a far ritentare
 * a Stripe consegne che non abbiamo motivo di rifiutare.
 *
 * Alla disdetta il piano torna `free` e **non** si cancella nulla: i dati
 * restano, l'accesso si restringe. Cancellare l'archivio di un cliente che ha
 * smesso di pagare è il modo più rapido per non riaverlo mai indietro, e in
 * Europa apre anche una questione di conservazione.
 */
export function parseSubscriptionEvent(payload: unknown): SubscriptionChange | null {
  const event = asRecord(payload);
  const rawType = asString(event.type);
  if (rawType === null || !(HANDLED_EVENTS as readonly string[]).includes(rawType)) return null;
  // Il controllo di appartenenza qui sopra è già la prova che il valore è uno
  // dei tipi gestiti: l'asserzione non aggiunge fiducia, la trascrive per il
  // sistema dei tipi.
  const type = rawType as HandledEvent;

  const object = asRecord(asRecord(event.data).object);
  const metadata = asRecord(object.metadata);

  const organizationId =
    asString(object.client_reference_id) ?? asString(metadata.organization_id);

  if (type === 'customer.subscription.deleted') {
    return {
      type,
      organizationId,
      customerId: asString(object.customer),
      subscriptionId: asString(object.id),
      plan: 'free',
      status: 'canceled',
      currentPeriodEnd: null,
    };
  }

  const status = asString(object.status) ?? 'active';
  const periodEndRaw = object.current_period_end;
  const currentPeriodEnd =
    typeof periodEndRaw === 'number' ? new Date(periodEndRaw * 1000).toISOString() : null;

  // Un abbonamento non in regola non concede il piano: `past_due` e `unpaid`
  // significano che il pagamento non è andato a buon fine.
  const healthy = status === 'active' || status === 'trialing';
  const plan: PlanId = healthy ? (asString(metadata.plan) === 'pro' ? 'pro' : 'pro') : 'free';

  return {
    type,
    organizationId,
    customerId: asString(object.customer),
    subscriptionId:
      type === 'checkout.session.completed' ? asString(object.subscription) : asString(object.id),
    plan,
    status,
    currentPeriodEnd,
  };
}

export const PLAN_PRICE_LABELS: Readonly<Record<PlanId, string>> = {
  free: PLANS.free.priceLabel,
  pro: PLANS.pro.priceLabel,
  enterprise: PLANS.enterprise.priceLabel,
};
