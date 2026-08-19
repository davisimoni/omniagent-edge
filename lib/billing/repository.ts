import { getSql } from '@/lib/db/client';
import type { SubscriptionChange } from '@/lib/billing/stripe';
import type { PlanId } from '@/lib/billing/plans';

/**
 * Applicazione degli eventi di abbonamento.
 *
 * **Gli eventi Stripe arrivano fuori ordine e più di una volta.** Un
 * `customer.subscription.updated` può precedere il `checkout.session.completed`
 * della stessa sessione, e ogni evento viene ritentato finché non riceve un 2xx.
 * Ogni scrittura qui è quindi idempotente: sovrascrive lo stato invece di
 * incrementarlo, così rieseguire lo stesso evento non cambia il risultato.
 */

export interface ApplyResult {
  readonly applied: boolean;
  readonly reason: string | null;
}

/**
 * Aggiorna il piano di un'organizzazione.
 *
 * La riconciliazione avviene per `organization_id` quando c'è, altrimenti per
 * `stripe_customer_id`: gli eventi di rinnovo non portano il riferimento
 * originale della sessione di checkout, e senza il secondo criterio un
 * abbonamento smetterebbe di aggiornarsi dopo il primo mese.
 */
export async function applySubscriptionChange(change: SubscriptionChange): Promise<ApplyResult> {
  const sql = getSql();

  if (change.organizationId !== null) {
    const rows = await sql`
      UPDATE organizations
      SET plan = ${change.plan},
          plan_status = ${change.status},
          stripe_customer_id = COALESCE(${change.customerId}, stripe_customer_id),
          stripe_subscription_id = COALESCE(${change.subscriptionId}, stripe_subscription_id),
          current_period_end = ${change.currentPeriodEnd}
      WHERE id = ${change.organizationId}
      RETURNING id`;
    if (rows.length > 0) return { applied: true, reason: null };
  }

  if (change.customerId !== null) {
    const rows = await sql`
      UPDATE organizations
      SET plan = ${change.plan},
          plan_status = ${change.status},
          stripe_subscription_id = COALESCE(${change.subscriptionId}, stripe_subscription_id),
          current_period_end = ${change.currentPeriodEnd}
      WHERE stripe_customer_id = ${change.customerId}
      RETURNING id`;
    if (rows.length > 0) return { applied: true, reason: null };
  }

  // Nessuna corrispondenza: si risponde comunque 200 al webhook, altrimenti
  // Stripe ritenta all'infinito un evento che non potremo mai riconciliare —
  // per esempio un pagamento nato in un altro ambiente.
  return {
    applied: false,
    reason: 'Nessuna organizzazione corrispondente per questo evento.',
  };
}

/** Associa un cliente Stripe a un'organizzazione prima del checkout. */
export async function linkStripeCustomer(
  organizationId: string,
  customerId: string,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE organizations
    SET stripe_customer_id = ${customerId}
    WHERE id = ${organizationId} AND stripe_customer_id IS NULL`;
}

/** Forza il piano di un'organizzazione. Riservato ad ambienti di sviluppo e supporto. */
export async function setPlan(organizationId: string, plan: PlanId): Promise<void> {
  const sql = getSql();
  await sql`UPDATE organizations SET plan = ${plan}, plan_status = 'active' WHERE id = ${organizationId}`;
}
