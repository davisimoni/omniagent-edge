import { generateText } from 'ai';
import { getAgentModel, getModelId, hasModelCredentials } from '@/lib/ai/model';
import { isDatabaseConfigured, getSql } from '@/lib/db/client';
import { isSessionConfigured } from '@/lib/auth/session';
import { isStripeConfigured, isWebhookConfigured } from '@/lib/billing/stripe';
import { readEnv } from '@/lib/env';
import { readUpstashConfig } from '@/lib/rate-limit';

/**
 * Diagnostica profonda: latenze misurate, non dichiarate.
 *
 * `/api/health` risponde a "è configurato?". Questa rotta risponde a "risponde?",
 * che è una domanda diversa e più utile: una connection string valida verso un
 * database sospeso, una chiave API revocata e un Redis irraggiungibile passano
 * tutti il primo controllo e falliscono al primo utente.
 *
 * **Ogni numero qui è un round-trip reale**, cronometrato attorno alla chiamata.
 * Nessuna stima, nessuna costante: è la stessa regola che governa i badge di
 * Developer Mode, dove le uniche cifre ammesse sono quelle vere per costruzione.
 *
 * **Non è un endpoint pubblico di ricognizione.** Riporta *se* una dipendenza
 * risponde e *in quanto tempo*, mai con quale host o quale chiave. In presenza
 * di `HEALTH_CHECK_TOKEN` richiede un bearer: le latenze dell'infrastruttura
 * sono informazione utile a chi la vuole sondare.
 */
export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

export const CHECK_TIMEOUT_MS = 4_000;

export type CheckStatus = 'ok' | 'degraded' | 'down' | 'not_configured';

export interface DependencyCheck {
  readonly name: string;
  readonly status: CheckStatus;
  /** Millisecondi del round-trip reale; `null` se non eseguito. */
  readonly latencyMs: number | null;
  readonly detail: string;
}

/** Soglia oltre la quale una dipendenza raggiungibile è comunque un problema. */
export const SLOW_THRESHOLD_MS = 1_500;

function classify(latencyMs: number): CheckStatus {
  return latencyMs > SLOW_THRESHOLD_MS ? 'degraded' : 'ok';
}

async function timed<T>(operation: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const started = performance.now();
  const value = await operation();
  return { ms: Math.round(performance.now() - started), value };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`timeout dopo ${ms} ms`)), ms),
    ),
  ]);
}

function failureDetail(error: unknown): string {
  // Il messaggio del driver può contenere host e utente della connection
  // string: resta nei log, non nella risposta.
  console.error('[health/deep] dipendenza non raggiungibile', error);
  return error instanceof Error && error.message.startsWith('timeout')
    ? error.message
    : 'non raggiungibile';
}

/** PostgreSQL: `SELECT 1` è il round-trip più corto che dimostri una connessione viva. */
async function checkDatabase(): Promise<DependencyCheck> {
  if (!isDatabaseConfigured()) {
    return {
      name: 'postgres',
      status: 'not_configured',
      latencyMs: null,
      detail: 'DATABASE_URL assente: account, cronologia e quote non disponibili.',
    };
  }
  try {
    const sql = getSql();
    const { ms } = await timed(() => withTimeout(sql`SELECT 1 AS ok`, CHECK_TIMEOUT_MS));
    return { name: 'postgres', status: classify(ms), latencyMs: ms, detail: 'connessione attiva' };
  } catch (error) {
    return { name: 'postgres', status: 'down', latencyMs: null, detail: failureDetail(error) };
  }
}

/** Upstash: un `PING` sul REST, che è la stessa via usata dal limitatore. */
async function checkRedis(): Promise<DependencyCheck> {
  const config = readUpstashConfig();
  if (config === null) {
    return {
      name: 'upstash-redis',
      status: 'not_configured',
      latencyMs: null,
      detail: 'conteggio quote in memoria e per istanza, non distribuito.',
    };
  }
  try {
    const { ms, value } = await timed(() =>
      withTimeout(
        fetch(`${config.url.replace(/\/+$/, '')}/ping`, {
          headers: { authorization: `Bearer ${config.token}` },
        }),
        CHECK_TIMEOUT_MS,
      ),
    );
    if (!value.ok) {
      return {
        name: 'upstash-redis',
        status: 'down',
        latencyMs: ms,
        detail: `il servizio ha risposto ${value.status}`,
      };
    }
    return { name: 'upstash-redis', status: classify(ms), latencyMs: ms, detail: 'PING riuscito' };
  } catch (error) {
    return { name: 'upstash-redis', status: 'down', latencyMs: null, detail: failureDetail(error) };
  }
}

/**
 * Anthropic: una generazione da un token, non una vera.
 *
 * `maxOutputTokens: 1` e `maxRetries: 0` rendono la sonda la più economica che
 * attraversi comunque autenticazione, routing e modello. Una generazione piena
 * costerebbe a ogni esecuzione, e una sonda che costa viene programmata di rado
 * — cioè non quando servirebbe. Senza ritentativi, perché qui il fallimento è
 * il dato: un tentativo andato a buon fine al terzo colpo va riportato come
 * problema, non nascosto dietro una latenza tripla.
 */
async function checkModel(): Promise<DependencyCheck> {
  if (!hasModelCredentials()) {
    return {
      name: 'anthropic',
      status: 'not_configured',
      latencyMs: null,
      detail: 'ANTHROPIC_API_KEY assente: audit ed estrazione non disponibili.',
    };
  }
  try {
    const model = getAgentModel(getModelId());
    const { ms } = await timed(() =>
      withTimeout(
        generateText({ model, prompt: 'ok', maxOutputTokens: 1, maxRetries: 0 }),
        CHECK_TIMEOUT_MS,
      ),
    );
    return { name: 'anthropic', status: classify(ms), latencyMs: ms, detail: 'API raggiungibile' };
  } catch (error) {
    return { name: 'anthropic', status: 'down', latencyMs: null, detail: failureDetail(error) };
  }
}

function checkConfigOnly(): DependencyCheck[] {
  return [
    {
      name: 'sessions',
      status: isSessionConfigured() ? 'ok' : 'not_configured',
      latencyMs: null,
      detail: isSessionConfigured()
        ? 'segreto di firma presente'
        : 'SESSION_SECRET assente: registrazione e accesso disabilitati.',
    },
    {
      name: 'stripe',
      status: isStripeConfigured()
        ? isWebhookConfigured()
          ? 'ok'
          : 'degraded'
        : 'not_configured',
      latencyMs: null,
      detail: !isStripeConfigured()
        ? 'STRIPE_SECRET_KEY assente: nessun pagamento.'
        : isWebhookConfigured()
          ? 'chiave e webhook configurati'
          : 'webhook non configurato: i cambi di piano non verranno applicati.',
    },
  ];
}

const OVERALL_RANK: Readonly<Record<CheckStatus, number>> = {
  ok: 0,
  not_configured: 1,
  degraded: 2,
  down: 3,
};

/**
 * Stato complessivo.
 *
 * Una dipendenza non configurata **non** rende il sistema `down`: senza vector
 * store o senza Stripe l'applicazione funziona, in modo ridotto e dichiarato.
 * Confondere "assente per scelta" con "guasto" farebbe scattare un allarme a
 * ogni installazione minima, e un allarme che suona sempre viene disattivato.
 */
export function overallStatus(checks: readonly DependencyCheck[]): CheckStatus {
  const worst = checks.reduce<CheckStatus>(
    (accumulator, check) =>
      OVERALL_RANK[check.status] > OVERALL_RANK[accumulator] ? check.status : accumulator,
    'ok',
  );
  return worst;
}

export async function GET(request: Request): Promise<Response> {
  const requiredToken = readEnv('HEALTH_CHECK_TOKEN');
  if (requiredToken !== undefined) {
    const provided = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
    if (provided !== requiredToken) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
  }

  const startedAt = performance.now();

  // In parallelo: le sonde sono indipendenti, e in sequenza il tempo totale
  // sarebbe la somma dei timeout invece del più lento.
  const [database, redis, model] = await Promise.all([
    checkDatabase(),
    checkRedis(),
    checkModel(),
  ]);

  const checks = [database, redis, model, ...checkConfigOnly()];
  const body = {
    status: overallStatus(checks),
    checkedAt: new Date().toISOString(),
    region: readEnv('VERCEL_REGION') ?? 'local',
    totalLatencyMs: Math.round(performance.now() - startedAt),
    checks,
  };

  return new Response(JSON.stringify(body), {
    // Sempre 200: lo stato sta nel corpo. Un 503 qui renderebbe la diagnostica
    // indistinguibile da un guasto della diagnostica stessa.
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
