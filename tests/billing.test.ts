import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PLAN,
  getPlan,
  hasFeature,
  isPlanId,
  nextPlanAfter,
  PLANS,
  PLAN_IDS,
  planAtLeast,
} from '@/lib/billing/plans';
import { evaluateQuota, periodEnd, periodStart } from '@/lib/billing/quota';
import {
  HANDLED_EVENTS,
  parseSubscriptionEvent,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from '@/lib/billing/stripe';

/**
 * Test di piani, quote e webhook.
 *
 * La quota è la funzione che decide se un cliente pagante può lavorare: deve
 * essere pura, riproducibile e spiegabile a chi contesta un blocco. Il webhook è
 * la porta da cui si entra senza pagare, se la firma non viene verificata.
 */

const SECRET = 'whsec_test_segreto';

async function signPayload(payload: string, timestamp: number, secret = SECRET): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const hex = Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `t=${timestamp},v1=${hex}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Piani
// ─────────────────────────────────────────────────────────────────────────────

describe('piani', () => {
  it('il piano Free include tre audit al mese, come promette il listino', () => {
    expect(PLANS.free.auditsPerMonth).toBe(3);
    expect(PLANS.free.priceUsd).toBe(0);
  });

  it('il piano Pro costa 99 dollari al mese', () => {
    expect(PLANS.pro.priceUsd).toBe(99);
    expect(PLANS.pro.priceLabel).toBe('$99');
  });

  it('Enterprise non ha tetto di audit né prezzo di listino', () => {
    expect(PLANS.enterprise.auditsPerMonth).toBeNull();
    expect(PLANS.enterprise.priceUsd).toBeNull();
  });

  it('ogni piano dichiara a chi serve, non solo che cosa contiene', () => {
    for (const id of PLAN_IDS) {
      expect(PLANS[id].audience.length).toBeGreaterThan(30);
      expect(PLANS[id].features.length).toBeGreaterThan(2);
    }
  });

  it('i piani non a trattativa dichiarano anche i propri limiti', () => {
    // Chi cerca il trucco e non lo trova diffida invece di convertire.
    expect(PLANS.free.limitations.length).toBeGreaterThan(0);
    expect(PLANS.pro.limitations.length).toBeGreaterThan(0);
  });

  it('un piano ignoto ripiega su Free, mai su un piano pagato', () => {
    expect(getPlan('platinum').id).toBe('free');
    expect(getPlan(null).id).toBe(DEFAULT_PLAN);
    expect(getPlan(undefined).id).toBe('free');
    expect(isPlanId('platinum')).toBe(false);
  });

  it('ordina i piani per capacità crescente', () => {
    expect(planAtLeast('pro', 'free')).toBe(true);
    expect(planAtLeast('free', 'pro')).toBe(false);
    expect(planAtLeast('enterprise', 'pro')).toBe(true);
    expect(planAtLeast('pro', 'pro')).toBe(true);
  });

  it('suggerisce il piano successivo, e nulla oltre Enterprise', () => {
    expect(nextPlanAfter('free')?.id).toBe('pro');
    expect(nextPlanAfter('pro')?.id).toBe('enterprise');
    expect(nextPlanAfter('enterprise')).toBeNull();
  });

  it('le funzionalità di squadra partono da Pro', () => {
    expect(hasFeature('free', 'teamNotifications')).toBe(false);
    expect(hasFeature('pro', 'teamNotifications')).toBe(true);
    expect(hasFeature('free', 'reviewAssignment')).toBe(false);
    expect(hasFeature('enterprise', 'versionComparison')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quote
// ─────────────────────────────────────────────────────────────────────────────

describe('periodo di fatturazione', () => {
  it('è il mese solare in UTC', () => {
    const now = new Date('2026-08-20T14:30:00Z');
    expect(periodStart(now).toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(periodEnd(now).toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('gestisce il passaggio d\'anno', () => {
    const now = new Date('2026-12-15T00:00:00Z');
    expect(periodEnd(now).toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });
});

describe('evaluateQuota', () => {
  const now = new Date('2026-08-20T12:00:00Z');

  it('lascia passare finché la quota non è esaurita', () => {
    const verdict = evaluateQuota({ plan: 'free', used: 0, now });
    expect(verdict.allowed).toBe(true);
    expect(verdict.remaining).toBe(3);
    expect(verdict.message).toBeNull();
  });

  it('avvisa sull\'ultimo credito, non a quota esaurita', () => {
    // Chi sta per finirli deve saperlo prima di caricare il contratto.
    const verdict = evaluateQuota({ plan: 'free', used: 2, now });
    expect(verdict.allowed).toBe(true);
    expect(verdict.remaining).toBe(1);
    expect(verdict.message).toContain('1 audit');
  });

  it('blocca al superamento e non produce resti negativi', () => {
    const verdict = evaluateQuota({ plan: 'free', used: 7, now });
    expect(verdict.allowed).toBe(false);
    expect(verdict.remaining).toBe(0);
  });

  it('il messaggio di blocco dice quanto, quando e cosa cambierebbe', () => {
    // Un paywall che dice solo "quota esaurita" fa chiudere la pagina.
    const verdict = evaluateQuota({ plan: 'free', used: 3, now });
    expect(verdict.message).toContain('3 audit');
    expect(verdict.message).toContain('settembre');
    expect(verdict.message).toContain('Pro');
    expect(verdict.message).toContain('$99');
    expect(verdict.suggestedPlan).toBe('pro');
  });

  it('non blocca mai un piano senza tetto', () => {
    const verdict = evaluateQuota({ plan: 'enterprise', used: 100_000, now });
    expect(verdict.allowed).toBe(true);
    expect(verdict.limit).toBeNull();
    expect(verdict.remaining).toBeNull();
    expect(verdict.suggestedPlan).toBeNull();
  });

  it('applica il tetto del piano Pro', () => {
    expect(evaluateQuota({ plan: 'pro', used: 99, now }).allowed).toBe(true);
    expect(evaluateQuota({ plan: 'pro', used: 100, now }).allowed).toBe(false);
  });

  it('è deterministico', () => {
    const input = { plan: 'free' as const, used: 2, now };
    expect(evaluateQuota(input)).toEqual(evaluateQuota(input));
  });

  it('indica sempre quando la quota si azzera', () => {
    expect(evaluateQuota({ plan: 'free', used: 3, now }).resetsAt).toBe(
      '2026-09-01T00:00:00.000Z',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Webhook
// ─────────────────────────────────────────────────────────────────────────────

describe('verifyWebhookSignature', () => {
  const payload = '{"type":"checkout.session.completed"}';
  const now = Date.UTC(2026, 7, 20, 12, 0, 0);
  const timestamp = Math.floor(now / 1000);

  it('accetta una firma valida', async () => {
    const header = await signPayload(payload, timestamp);
    expect(await verifyWebhookSignature(payload, header, SECRET, now)).toEqual({
      valid: true,
      reason: null,
    });
  });

  it('rifiuta un corpo modificato dopo la firma', async () => {
    const header = await signPayload(payload, timestamp);
    const tampered = payload.replace('completed', 'expired');
    expect((await verifyWebhookSignature(tampered, header, SECRET, now)).valid).toBe(false);
  });

  it('rifiuta una firma prodotta con un altro segreto', async () => {
    // Senza questa verifica l'endpoint concede abbonamenti a chiunque ne
    // conosca l'URL.
    const header = await signPayload(payload, timestamp, 'whsec_segreto_di_un_altro');
    expect((await verifyWebhookSignature(payload, header, SECRET, now)).valid).toBe(false);
  });

  it('rifiuta un replay oltre la tolleranza', async () => {
    const header = await signPayload(payload, timestamp);
    const later = now + (WEBHOOK_TOLERANCE_SECONDS + 60) * 1000;
    const result = await verifyWebhookSignature(payload, header, SECRET, later);
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('replay');
  });

  it('accetta una consegna in ritardo ma entro la tolleranza', async () => {
    const header = await signPayload(payload, timestamp);
    const later = now + (WEBHOOK_TOLERANCE_SECONDS - 30) * 1000;
    expect((await verifyWebhookSignature(payload, header, SECRET, later)).valid).toBe(true);
  });

  it('rifiuta header assenti o malformati', async () => {
    expect((await verifyWebhookSignature(payload, null, SECRET, now)).valid).toBe(false);
    expect((await verifyWebhookSignature(payload, 'senza-struttura', SECRET, now)).valid).toBe(false);
    expect((await verifyWebhookSignature(payload, 't=abc,v1=xx', SECRET, now)).valid).toBe(false);
  });
});

describe('parseSubscriptionEvent', () => {
  it('riconosce il completamento di un checkout e ne ricava il workspace', () => {
    const change = parseSubscriptionEvent({
      type: 'checkout.session.completed',
      data: {
        object: {
          client_reference_id: 'org_123',
          customer: 'cus_1',
          subscription: 'sub_1',
          status: 'active',
          metadata: { plan: 'pro' },
        },
      },
    });

    expect(change).toMatchObject({
      organizationId: 'org_123',
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      plan: 'pro',
    });
  });

  it('ricava il workspace dai metadati quando manca il riferimento di sessione', () => {
    // Gli eventi di rinnovo non portano `client_reference_id`.
    const change = parseSubscriptionEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_1',
          customer: 'cus_1',
          status: 'active',
          current_period_end: 1_800_000_000,
          metadata: { organization_id: 'org_456', plan: 'pro' },
        },
      },
    });

    expect(change?.organizationId).toBe('org_456');
    expect(change?.currentPeriodEnd).toBe(new Date(1_800_000_000 * 1000).toISOString());
  });

  it('riporta al piano Free un abbonamento non in regola', () => {
    // `past_due` significa che il pagamento non è andato a buon fine: concedere
    // comunque il piano regalerebbe il servizio a chi non sta pagando.
    const change = parseSubscriptionEvent({
      type: 'customer.subscription.updated',
      data: { object: { id: 'sub_1', customer: 'cus_1', status: 'past_due', metadata: {} } },
    });
    expect(change?.plan).toBe('free');
    expect(change?.status).toBe('past_due');
  });

  it('alla disdetta riporta a Free senza cancellare nulla', () => {
    const change = parseSubscriptionEvent({
      type: 'customer.subscription.deleted',
      data: { object: { id: 'sub_1', customer: 'cus_1', metadata: { organization_id: 'org_1' } } },
    });
    expect(change).toMatchObject({ plan: 'free', status: 'canceled', organizationId: 'org_1' });
  });

  it('ignora gli eventi non gestiti invece di trattarli come errori', () => {
    // Stripe ne invia decine: rifiutarli farebbe ritentare consegne che non
    // abbiamo motivo di respingere.
    expect(parseSubscriptionEvent({ type: 'invoice.created', data: { object: {} } })).toBeNull();
    expect(parseSubscriptionEvent({})).toBeNull();
    expect(parseSubscriptionEvent(null)).toBeNull();
    expect(parseSubscriptionEvent('stringa')).toBeNull();
  });

  it('gestisce esattamente gli eventi dichiarati', () => {
    for (const type of HANDLED_EVENTS) {
      expect(parseSubscriptionEvent({ type, data: { object: { metadata: {} } } })).not.toBeNull();
    }
  });
});
