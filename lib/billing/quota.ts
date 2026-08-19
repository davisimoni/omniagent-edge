import { getSql, newId } from '@/lib/db/client';
import { getPlan, nextPlanAfter, type Plan, type PlanId } from '@/lib/billing/plans';

/**
 * Quote di consumo.
 *
 * La parte che decide — `evaluateQuota` — è pura: piano, consumo e istante in
 * ingresso, verdetto in uscita. È testabile senza database e produce sempre la
 * stessa risposta a parità di input, che è ciò che serve quando un cliente
 * contesta un blocco.
 *
 * Il conteggio è **fail-closed**: se il database non risponde, la richiesta non
 * passa. Il verso opposto sarebbe più gentile e trasformerebbe un guasto del
 * database in audit illimitati e gratuiti per chiunque se ne accorga.
 */

export const USAGE_KINDS = ['audit', 'extract', 'chat'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

/** Inizio del periodo di fatturazione: mese solare in UTC. */
export function periodStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

export function periodEnd(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
}

export interface QuotaVerdict {
  readonly allowed: boolean;
  readonly plan: PlanId;
  readonly limit: number | null;
  readonly used: number;
  /** `null` quando il piano non ha tetto. */
  readonly remaining: number | null;
  readonly resetsAt: string;
  /** Piano da proporre a chi ha esaurito; `null` se è già al massimo. */
  readonly suggestedPlan: PlanId | null;
  /** Messaggio già pronto per l'interfaccia: un blocco senza spiegazione è un muro. */
  readonly message: string | null;
}

export interface EvaluateQuotaInput {
  readonly plan: PlanId;
  readonly used: number;
  readonly now?: Date;
}

/**
 * Decide se una richiesta rientra nella quota.
 *
 * Il messaggio dice tre cose in quest'ordine: quanto è stato consumato, quando
 * si azzera, che cosa cambierebbe passando al piano successivo. Un paywall che
 * dice soltanto "quota esaurita" costringe l'utente a cercare altrove le altre
 * due, e la maggior parte non cerca: chiude.
 */
export function evaluateQuota(input: EvaluateQuotaInput): QuotaVerdict {
  const now = input.now ?? new Date();
  const plan = getPlan(input.plan);
  const resetsAt = periodEnd(now).toISOString();

  if (plan.auditsPerMonth === null) {
    return {
      allowed: true,
      plan: plan.id,
      limit: null,
      used: input.used,
      remaining: null,
      resetsAt,
      suggestedPlan: null,
      message: null,
    };
  }

  const remaining = Math.max(0, plan.auditsPerMonth - input.used);
  const allowed = input.used < plan.auditsPerMonth;
  const suggested = nextPlanAfter(plan.id);

  if (allowed) {
    return {
      allowed: true,
      plan: plan.id,
      limit: plan.auditsPerMonth,
      used: input.used,
      remaining,
      resetsAt,
      suggestedPlan: suggested?.id ?? null,
      message:
        // L'avviso arriva sull'ultimo credito, non a quota esaurita: chi sta per
        // finirli deve poterlo sapere prima di caricare il contratto, non dopo.
        remaining === 1
          ? `Ti resta 1 audit su ${plan.auditsPerMonth} di questo mese.`
          : null,
    };
  }

  return {
    allowed: false,
    plan: plan.id,
    limit: plan.auditsPerMonth,
    used: input.used,
    remaining: 0,
    resetsAt,
    suggestedPlan: suggested?.id ?? null,
    message: buildExhaustedMessage(plan, now, suggested),
  };
}

function buildExhaustedMessage(plan: Plan, now: Date, suggested: Plan | null): string {
  const reset = periodEnd(now).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  const base = `Hai usato tutti i ${plan.auditsPerMonth ?? 0} audit inclusi nel piano ${plan.name}. La quota si azzera il ${reset}.`;
  if (suggested === null) return base;

  const included =
    suggested.auditsPerMonth === null
      ? 'audit senza tetto'
      : `${suggested.auditsPerMonth} audit al mese`;
  return `${base} Il piano ${suggested.name} include ${included} a ${suggested.priceLabel} ${suggested.period}.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistenza
// ─────────────────────────────────────────────────────────────────────────────

/** Consumi del periodo corrente, per tipo. */
export async function countUsage(
  organizationId: string,
  kind: UsageKind,
  now: Date = new Date(),
): Promise<number> {
  const sql = getSql();
  const rows = await sql`
    SELECT COALESCE(SUM(units), 0) AS total
    FROM usage_events
    WHERE organization_id = ${organizationId}
      AND kind = ${kind}
      AND created_at >= ${periodStart(now).toISOString()}`;
  return Number(rows[0]?.total ?? 0);
}

export interface RecordUsageInput {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly kind: UsageKind;
  readonly units?: number;
  readonly costUsd?: number | null;
}

/**
 * Registra un consumo.
 *
 * Va chiamata **dopo** che l'operazione è riuscita. Consumare il credito prima
 * significa addebitare un audit anche quando il modello fallisce a metà, ed è
 * il tipo di errore che l'utente nota e non perdona. Il verso opposto — un
 * audit riuscito e non contato — costa a noi, ed è il verso giusto in cui
 * sbagliare.
 */
export async function recordUsage(input: RecordUsageInput): Promise<void> {
  const sql = getSql();
  await sql`
    INSERT INTO usage_events (id, organization_id, user_id, kind, units, cost_usd)
    VALUES (
      ${newId('use')},
      ${input.organizationId},
      ${input.userId},
      ${input.kind},
      ${input.units ?? 1},
      ${input.costUsd ?? null}
    )`;
}

export interface UsageSummary {
  readonly audits: number;
  readonly costUsd: number;
  readonly periodStart: string;
  readonly periodEnd: string;
}

/** Riepilogo del periodo, per la pagina impostazioni. */
export async function getUsageSummary(
  organizationId: string,
  now: Date = new Date(),
): Promise<UsageSummary> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      COALESCE(SUM(units) FILTER (WHERE kind = 'audit'), 0) AS audits,
      COALESCE(SUM(cost_usd), 0) AS cost
    FROM usage_events
    WHERE organization_id = ${organizationId}
      AND created_at >= ${periodStart(now).toISOString()}`;

  return {
    audits: Number(rows[0]?.audits ?? 0),
    costUsd: Number(rows[0]?.cost ?? 0),
    periodStart: periodStart(now).toISOString(),
    periodEnd: periodEnd(now).toISOString(),
  };
}

/** Verdetto completo per un'organizzazione, con il conteggio letto dal database. */
export async function checkAuditQuota(
  organizationId: string,
  plan: PlanId,
  now: Date = new Date(),
): Promise<QuotaVerdict> {
  const used = await countUsage(organizationId, 'audit', now);
  return evaluateQuota({ plan, used, now });
}
