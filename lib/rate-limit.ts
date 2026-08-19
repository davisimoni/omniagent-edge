import { readEnv } from '@/lib/env';

/**
 * Rate limiting a finestra scorrevole, con Upstash Redis e ripiego in memoria.
 *
 * **Perché il protocollo REST invece del pacchetto ufficiale.** Upstash espone
 * Redis su HTTP: `@upstash/redis` e `@upstash/ratelimit` sono involucri su una
 * POST a `/pipeline`. Parlarlo direttamente costa trenta righe, elimina due
 * dipendenze dal bundle del middleware — che gira su ogni richiesta e dove ogni
 * kilobyte è latenza di cold start — e soprattutto rende lo store sostituibile
 * nei test senza montare un finto modulo.
 *
 * **Perché finestra scorrevole e non finestra fissa.** Una finestra fissa
 * consente il doppio del limite a cavallo del confine: sessanta richieste alle
 * 12:00:59 e altre sessanta alle 12:01:01 passano entrambe, e il fornitore che
 * vuole saturare la spesa in token di un audit lo scopre al primo tentativo. La
 * finestra scorrevole pesa il conteggio della finestra precedente sulla quota di
 * tempo ancora coperta, e il confine smette di essere un varco.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Politiche
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitPolicy {
  /** Nome della politica: entra nella chiave, così i budget non si mescolano. */
  readonly name: string;
  readonly limit: number;
  readonly windowMs: number;
}

/**
 * Le quote sono per costo, non per uniformità.
 *
 * Un audit su un contratto di quaranta pagine costa ordini di grandezza più di
 * una ricerca: dare a entrambi lo stesso budget significa o strozzare la ricerca
 * o lasciare aperta la spesa. Il numero che conta qui è quello del portafoglio,
 * non quello del carico.
 */
export const RATE_LIMIT_POLICIES = {
  audit: { name: 'audit', limit: 10, windowMs: 60_000 },
  chat: { name: 'chat', limit: 30, windowMs: 60_000 },
  extract: { name: 'extract', limit: 20, windowMs: 60_000 },
  default: { name: 'default', limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

export type PolicyName = keyof typeof RATE_LIMIT_POLICIES;

/** Moltiplicatore per chi si presenta con un token: identificato, quindi tracciabile. */
export const TOKEN_QUOTA_MULTIPLIER = 5;

// ─────────────────────────────────────────────────────────────────────────────
// Identità
// ─────────────────────────────────────────────────────────────────────────────

export type IdentityKind = 'token' | 'ip' | 'anonymous';

export interface ClientIdentity {
  readonly kind: IdentityKind;
  /** Valore grezzo, mai persistito né registrato: viene subito ridotto a digest. */
  readonly value: string;
}

/**
 * Ricava l'identità del chiamante dagli header.
 *
 * **`x-forwarded-for` non è attendibile e non va usato per primo.** È un header
 * che il client può scrivere: chi vuole aggirare il limitatore manda un
 * `X-Forwarded-For` diverso a ogni richiesta e ottiene quota infinita. Su Vercel
 * l'unico valore che il client non può falsificare è quello che la piattaforma
 * scrive di suo pugno, `x-vercel-forwarded-for`; `x-real-ip` è il secondo in
 * ordine di affidabilità. Solo dopo, e solo perché in sviluppo locale non
 * esistono, si guarda l'ultimo salto di `x-forwarded-for` — l'ultimo, non il
 * primo, perché è quello scritto dal proxy più vicino a noi.
 */
export function resolveIdentity(headers: Headers): ClientIdentity {
  const authorization = headers.get('authorization');
  if (authorization !== null) {
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    if (token.length >= 8) return { kind: 'token', value: token };
  }

  const apiKey = headers.get('x-api-key');
  if (apiKey !== null && apiKey.trim().length >= 8) {
    return { kind: 'token', value: apiKey.trim() };
  }

  const vercelForwarded = headers.get('x-vercel-forwarded-for');
  if (vercelForwarded !== null && vercelForwarded.trim().length > 0) {
    return { kind: 'ip', value: firstHop(vercelForwarded) };
  }

  const realIp = headers.get('x-real-ip');
  if (realIp !== null && realIp.trim().length > 0) {
    return { kind: 'ip', value: realIp.trim() };
  }

  const forwarded = headers.get('x-forwarded-for');
  if (forwarded !== null && forwarded.trim().length > 0) {
    return { kind: 'ip', value: lastHop(forwarded) };
  }

  // Nessun indicatore: una sola corsia condivisa. Meglio un limite comune che
  // nessun limite — chi non è identificabile non merita una quota dedicata.
  return { kind: 'anonymous', value: 'anonymous' };
}

function firstHop(header: string): string {
  return header.split(',')[0]?.trim() ?? 'unknown';
}

function lastHop(header: string): string {
  const parts = header.split(',');
  return parts[parts.length - 1]?.trim() ?? 'unknown';
}

/**
 * Riduce l'identità a un digest.
 *
 * Un indirizzo IP è un dato personale ai sensi dell'art. 4 GDPR. Tenerlo in
 * chiaro come chiave Redis significa costruire, senza volerlo, un registro di
 * chi ha usato il servizio e quando — su un archivio di terza parte, per una
 * finalità che non è quella dichiarata. Il digest conserva la sola proprietà che
 * serve al limitatore, cioè distinguere due chiamanti, e perde tutto il resto.
 *
 * Il sale rende il digest non riconducibile per forza bruta: senza, provare i
 * quattro miliardi di IPv4 e confrontare i digest è questione di minuti.
 */
export async function hashIdentity(identity: ClientIdentity, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode(`${salt}:${identity.kind}:${identity.value}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 12))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Sale del digest; senza configurazione se ne usa uno di sviluppo, dichiarato tale. */
export function getIdentitySalt(): string {
  return readEnv('RATE_LIMIT_SALT') ?? readEnv('ANTHROPIC_API_KEY') ?? 'omniagent-dev-salt';
}

// ─────────────────────────────────────────────────────────────────────────────
// Aritmetica della finestra scorrevole
// ─────────────────────────────────────────────────────────────────────────────

export function windowIndexFor(now: number, windowMs: number): number {
  return Math.floor(now / windowMs);
}

/** Quota di finestra corrente già trascorsa, fra 0 e 1. */
export function elapsedRatio(now: number, windowMs: number): number {
  return (now % windowMs) / windowMs;
}

/**
 * Conteggio pesato: la finestra precedente contribuisce per la parte di tempo
 * che ricade ancora dentro l'intervallo scorrevole.
 *
 * A metà finestra, cinquanta richieste nella precedente valgono venticinque.
 * È un'approssimazione — presuppone che le richieste fossero distribuite in modo
 * uniforme — ma costa due contatori invece di un registro di timestamp per
 * chiamante, e su un limitatore l'approssimazione per eccesso è quella giusta.
 */
export function slidingWindowCount(
  previousCount: number,
  currentCount: number,
  elapsed: number,
): number {
  const clamped = Math.min(1, Math.max(0, elapsed));
  return previousCount * (1 - clamped) + currentCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

export interface WindowCounts {
  readonly current: number;
  readonly previous: number;
}

export interface RateLimitStore {
  readonly backend: 'upstash' | 'memory';
  /** Incrementa la finestra corrente e restituisce i due conteggi. */
  bump(key: string, windowIndex: number, ttlMs: number): Promise<WindowCounts>;
}

/**
 * Ripiego in memoria.
 *
 * **Limite da conoscere prima di affidarcisi.** Su Vercel ogni istanza ha la
 * propria memoria: con quattro istanze attive il limite effettivo è quattro
 * volte quello configurato, e a freddo riparte da zero. Va benissimo in
 * sviluppo e come rete di sicurezza quando Redis non risponde; **non** è un
 * controllo di sicurezza distribuito, e `degraded: true` lo dichiara a chi
 * legge la risposta invece di lasciar credere il contrario.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly backend = 'memory' as const;
  private readonly counters = new Map<string, { count: number; expiresAt: number }>();

  constructor(private readonly maxEntries = 10_000) {}

  async bump(key: string, windowIndex: number, ttlMs: number): Promise<WindowCounts> {
    const now = Date.now();
    this.evictExpired(now);

    const currentKey = `${key}:${windowIndex}`;
    const previousKey = `${key}:${windowIndex - 1}`;

    const entry = this.counters.get(currentKey);
    const nextCount = entry === undefined || entry.expiresAt <= now ? 1 : entry.count + 1;
    this.counters.set(currentKey, { count: nextCount, expiresAt: now + ttlMs });

    const previous = this.counters.get(previousKey);
    const previousCount = previous !== undefined && previous.expiresAt > now ? previous.count : 0;

    return { current: nextCount, previous: previousCount };
  }

  private evictExpired(now: number): void {
    if (this.counters.size < this.maxEntries) return;
    for (const [key, entry] of this.counters) {
      if (entry.expiresAt <= now) this.counters.delete(key);
    }
    // Se dopo la potatura la mappa è ancora piena, si svuota: un limitatore che
    // consuma memoria senza tetto è un modo elaborato di causare il guasto da
    // cui doveva proteggere.
    if (this.counters.size >= this.maxEntries) this.counters.clear();
  }

  /** Solo per i test: azzera lo stato fra un caso e l'altro. */
  reset(): void {
    this.counters.clear();
  }
}

export interface UpstashConfig {
  readonly url: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Store su Upstash Redis via REST.
 *
 * Una sola andata e ritorno: `INCR` della finestra corrente, `PEXPIRE ... NX`
 * per darle una scadenza senza prolungarla a ogni colpo, `GET` della precedente.
 * Tre comandi in pipeline, un round-trip — perché questo codice sta davanti a
 * ogni richiesta e il suo costo si somma a quello di tutte.
 */
export class UpstashRateLimitStore implements RateLimitStore {
  readonly backend = 'upstash' as const;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly config: UpstashConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 800;
  }

  async bump(key: string, windowIndex: number, ttlMs: number): Promise<WindowCounts> {
    const currentKey = `${key}:${windowIndex}`;
    const previousKey = `${key}:${windowIndex - 1}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.config.url.replace(/\/+$/, '')}/pipeline`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', currentKey],
          // `NX` è la parte che conta: senza, ogni richiesta rinnoverebbe la
          // scadenza e la finestra non si chiuderebbe mai.
          ['PEXPIRE', currentKey, String(Math.ceil(ttlMs)), 'NX'],
          ['GET', previousKey],
        ]),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Upstash ha risposto ${response.status}`);
      }

      const payload: unknown = await response.json();
      if (!Array.isArray(payload) || payload.length < 3) {
        throw new Error('Risposta Upstash in formato inatteso');
      }

      return {
        current: toCount(readResult(payload[0])),
        previous: toCount(readResult(payload[2])),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function readResult(entry: unknown): unknown {
  if (typeof entry === 'object' && entry !== null && 'result' in entry) {
    return (entry as { result: unknown }).result;
  }
  return entry;
}

function toCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.round(value));
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Limitatore
// ─────────────────────────────────────────────────────────────────────────────

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  /** Millisecondi epoch in cui la quota torna disponibile. */
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
  readonly backend: 'upstash' | 'memory';
  /** True quando il conteggio non è distribuito e vale solo per questa istanza. */
  readonly degraded: boolean;
  readonly policy: string;
  readonly identityKind: IdentityKind;
}

export interface RateLimiterOptions {
  readonly store?: RateLimitStore;
  readonly fallbackStore?: RateLimitStore;
  readonly salt?: string;
  readonly now?: () => number;
}

/** Store condiviso di processo: creare una mappa per richiesta non conterebbe nulla. */
const sharedMemoryStore = new MemoryRateLimitStore();

export function getSharedMemoryStore(): MemoryRateLimitStore {
  return sharedMemoryStore;
}

/** Configurazione Upstash da ambiente; `null` se assente — non è un errore. */
export function readUpstashConfig(): { url: string; token: string } | null {
  const url = readEnv('UPSTASH_REDIS_REST_URL');
  const token = readEnv('UPSTASH_REDIS_REST_TOKEN');
  if (url === undefined || token === undefined) return null;
  return { url, token };
}

export function createStore(): RateLimitStore {
  const config = readUpstashConfig();
  if (config === null) return sharedMemoryStore;
  return new UpstashRateLimitStore(config);
}

/** Quota effettiva: chi si identifica con un token ne ottiene di più. */
export function effectiveLimit(policy: RateLimitPolicy, kind: IdentityKind): number {
  return kind === 'token' ? policy.limit * TOKEN_QUOTA_MULTIPLIER : policy.limit;
}

/**
 * Applica la politica.
 *
 * **Comportamento in caso di guasto di Redis.** Non si apre e non si chiude: si
 * ripiega sul contatore in memoria. Aprire lascerebbe la spesa in token senza
 * argine proprio quando l'infrastruttura è già in difficoltà; chiudere
 * spegnerebbe il servizio per un guasto in un componente accessorio, cioè
 * trasformerebbe un problema di Redis in un'interruzione del prodotto. Il
 * ripiego conserva un limite reale per istanza e lo dichiara con `degraded`.
 */
export async function checkRateLimit(
  identity: ClientIdentity,
  policy: RateLimitPolicy,
  options: RateLimiterOptions = {},
): Promise<RateLimitDecision> {
  const now = (options.now ?? Date.now)();
  const store = options.store ?? createStore();
  const fallback = options.fallbackStore ?? sharedMemoryStore;
  const salt = options.salt ?? getIdentitySalt();

  const digest = await hashIdentity(identity, salt);
  const key = `omniagent:rl:${policy.name}:${digest}`;
  const index = windowIndexFor(now, policy.windowMs);
  // Due finestre di vita: la corrente serve ora, la precedente serve al peso.
  const ttlMs = policy.windowMs * 2;

  let counts: WindowCounts;
  let backend = store.backend;
  let degraded = store.backend === 'memory';

  try {
    counts = await store.bump(key, index, ttlMs);
  } catch (error) {
    console.warn('[rate-limit] store non raggiungibile, ripiego in memoria', {
      backend: store.backend,
      reason: error instanceof Error ? error.message : 'sconosciuto',
    });
    counts = await fallback.bump(key, index, ttlMs);
    backend = fallback.backend;
    degraded = true;
  }

  const limit = effectiveLimit(policy, identity.kind);
  const weighted = slidingWindowCount(counts.previous, counts.current, elapsedRatio(now, policy.windowMs));
  const allowed = weighted <= limit;
  const resetAt = (index + 1) * policy.windowMs;

  return {
    allowed,
    limit,
    remaining: Math.max(0, Math.floor(limit - weighted)),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    backend,
    degraded,
    policy: policy.name,
    identityKind: identity.kind,
  };
}

/** Header standard, così un client automatico può autoregolarsi invece di ritentare a vuoto. */
export function rateLimitHeaders(decision: RateLimitDecision): Record<string, string> {
  const headers: Record<string, string> = {
    'ratelimit-limit': String(decision.limit),
    'ratelimit-remaining': String(decision.remaining),
    'ratelimit-reset': String(Math.ceil((decision.resetAt - Date.now()) / 1000)),
    'x-ratelimit-policy': decision.policy,
  };
  if (decision.degraded) headers['x-ratelimit-degraded'] = 'true';
  if (!decision.allowed) headers['retry-after'] = String(decision.retryAfterSeconds);
  return headers;
}

/** Politica applicabile a un percorso; `null` per ciò che non va limitato. */
export function policyForPath(pathname: string): RateLimitPolicy | null {
  if (!pathname.startsWith('/api/')) return null;
  // La diagnostica deve restare raggiungibile anche sotto pressione: è quella
  // che dice se il sistema è configurato, e serve proprio quando qualcosa va storto.
  if (pathname.startsWith('/api/health')) return null;
  if (pathname.startsWith('/api/audit')) return RATE_LIMIT_POLICIES.audit;
  if (pathname.startsWith('/api/chat')) return RATE_LIMIT_POLICIES.chat;
  if (pathname.startsWith('/api/extract')) return RATE_LIMIT_POLICIES.extract;
  return RATE_LIMIT_POLICIES.default;
}
