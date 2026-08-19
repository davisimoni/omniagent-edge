import { describe, expect, it, vi } from 'vitest';
import {
  checkRateLimit,
  effectiveLimit,
  elapsedRatio,
  hashIdentity,
  MemoryRateLimitStore,
  policyForPath,
  RATE_LIMIT_POLICIES,
  rateLimitHeaders,
  resolveIdentity,
  slidingWindowCount,
  TOKEN_QUOTA_MULTIPLIER,
  UpstashRateLimitStore,
  windowIndexFor,
  type RateLimitStore,
} from '@/lib/rate-limit';

/**
 * Test del limitatore di richieste.
 *
 * Due proprietà contano più delle altre e sono verificate per prime: che un
 * header falsificabile dal client non possa concedere quota infinita, e che un
 * guasto di Redis non apra le porte. Il resto è aritmetica, che va comunque
 * fissata perché è ciò che decide se una richiesta passa.
 */

const SALT = 'sale-di-prova';

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

// ─────────────────────────────────────────────────────────────────────────────
// Identità
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveIdentity', () => {
  it('preferisce il token quando presente', () => {
    const identity = resolveIdentity(headers({ authorization: 'Bearer chiave-molto-lunga' }));
    expect(identity).toEqual({ kind: 'token', value: 'chiave-molto-lunga' });
  });

  it('accetta anche x-api-key', () => {
    expect(resolveIdentity(headers({ 'x-api-key': 'abcdefgh12' })).kind).toBe('token');
  });

  it('ignora un token troppo corto per essere reale', () => {
    const identity = resolveIdentity(headers({ authorization: 'Bearer abc', 'x-real-ip': '9.9.9.9' }));
    expect(identity).toEqual({ kind: 'ip', value: '9.9.9.9' });
  });

  it('NON si fa dettare l\'identità da un x-forwarded-for scritto dal client', () => {
    // È il tentativo di aggiramento più immediato: cambiare XFF a ogni richiesta
    // per ottenere una corsia nuova ogni volta. L'header della piattaforma vince.
    const identity = resolveIdentity(
      headers({
        'x-forwarded-for': '1.2.3.4',
        'x-vercel-forwarded-for': '203.0.113.7',
      }),
    );
    expect(identity).toEqual({ kind: 'ip', value: '203.0.113.7' });
  });

  it('preferisce x-real-ip a x-forwarded-for', () => {
    const identity = resolveIdentity(
      headers({ 'x-forwarded-for': '1.2.3.4', 'x-real-ip': '203.0.113.9' }),
    );
    expect(identity.value).toBe('203.0.113.9');
  });

  it('da x-forwarded-for prende l\'ULTIMO salto, non il primo', () => {
    // Il primo è quello dichiarato dal client; l'ultimo è quello scritto dal
    // proxy più vicino a noi, cioè l'unico che non abbiamo motivo di sospettare.
    const identity = resolveIdentity(headers({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }));
    expect(identity.value).toBe('3.3.3.3');
  });

  it('ripiega su una corsia condivisa quando non c\'è alcun indicatore', () => {
    expect(resolveIdentity(headers({}))).toEqual({ kind: 'anonymous', value: 'anonymous' });
  });
});

describe('hashIdentity', () => {
  const identity = { kind: 'ip' as const, value: '203.0.113.7' };

  it('è deterministico a parità di sale', async () => {
    expect(await hashIdentity(identity, SALT)).toBe(await hashIdentity(identity, SALT));
  });

  it('produce chiavi diverse con sali diversi', async () => {
    expect(await hashIdentity(identity, SALT)).not.toBe(await hashIdentity(identity, 'altro-sale'));
  });

  it('non lascia trasparire l\'indirizzo: è un dato personale, non una chiave', async () => {
    const digest = await hashIdentity(identity, SALT);
    expect(digest).not.toContain('203');
    expect(digest).toMatch(/^[0-9a-f]{24}$/);
  });

  it('distingue un token da un IP di identico valore', async () => {
    const asIp = await hashIdentity({ kind: 'ip', value: 'x'.repeat(12) }, SALT);
    const asToken = await hashIdentity({ kind: 'token', value: 'x'.repeat(12) }, SALT);
    expect(asIp).not.toBe(asToken);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Aritmetica della finestra
// ─────────────────────────────────────────────────────────────────────────────

describe('finestra scorrevole', () => {
  it('indicizza le finestre per intervalli contigui', () => {
    expect(windowIndexFor(0, 60_000)).toBe(0);
    expect(windowIndexFor(59_999, 60_000)).toBe(0);
    expect(windowIndexFor(60_000, 60_000)).toBe(1);
  });

  it('misura la quota di finestra trascorsa', () => {
    expect(elapsedRatio(0, 60_000)).toBe(0);
    expect(elapsedRatio(30_000, 60_000)).toBe(0.5);
    expect(elapsedRatio(90_000, 60_000)).toBe(0.5);
  });

  it('a inizio finestra il conteggio precedente pesa per intero', () => {
    expect(slidingWindowCount(40, 5, 0)).toBe(45);
  });

  it('a metà finestra il conteggio precedente pesa la metà', () => {
    expect(slidingWindowCount(40, 5, 0.5)).toBe(25);
  });

  it('a fine finestra il conteggio precedente non pesa più', () => {
    expect(slidingWindowCount(40, 5, 1)).toBe(5);
  });

  it('chiude il varco di confine che una finestra fissa lascerebbe aperto', () => {
    // 60 richieste appena prima del confine e 60 subito dopo: con finestra fissa
    // passerebbero tutte. Qui, un istante dopo il confine, il conteggio pesato
    // vale ancora quasi 120.
    expect(slidingWindowCount(60, 60, 0.01)).toBeCloseTo(119.4, 1);
  });

  it('limita il rapporto fuori scala invece di propagarlo', () => {
    expect(slidingWindowCount(40, 5, 1.7)).toBe(5);
    expect(slidingWindowCount(40, 5, -3)).toBe(45);
  });
});

describe('effectiveLimit', () => {
  it('concede più quota a chi si identifica con un token', () => {
    const policy = RATE_LIMIT_POLICIES.audit;
    expect(effectiveLimit(policy, 'ip')).toBe(policy.limit);
    expect(effectiveLimit(policy, 'token')).toBe(policy.limit * TOKEN_QUOTA_MULTIPLIER);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Store
// ─────────────────────────────────────────────────────────────────────────────

describe('MemoryRateLimitStore', () => {
  it('incrementa la finestra corrente', async () => {
    const store = new MemoryRateLimitStore();
    expect(await store.bump('k', 10, 60_000)).toEqual({ current: 1, previous: 0 });
    expect(await store.bump('k', 10, 60_000)).toEqual({ current: 2, previous: 0 });
  });

  it('riporta il conteggio della finestra precedente', async () => {
    const store = new MemoryRateLimitStore();
    await store.bump('k', 10, 60_000);
    await store.bump('k', 10, 60_000);
    expect(await store.bump('k', 11, 60_000)).toEqual({ current: 1, previous: 2 });
  });

  it('tiene separate chiavi diverse', async () => {
    const store = new MemoryRateLimitStore();
    await store.bump('a', 1, 60_000);
    expect(await store.bump('b', 1, 60_000)).toEqual({ current: 1, previous: 0 });
  });

  it('non cresce senza limite: un limitatore non deve causare il guasto da cui difende', async () => {
    const store = new MemoryRateLimitStore(4);
    for (let index = 0; index < 40; index += 1) {
      await store.bump(`chiave-${index}`, 1, 60_000);
    }
    // Il contatore riparte, ma la memoria resta limitata.
    expect((await store.bump('chiave-nuova', 1, 60_000)).current).toBeGreaterThanOrEqual(1);
  });
});

describe('UpstashRateLimitStore', () => {
  function fetchStub(payload: unknown, ok = true) {
    return vi.fn(
      async () =>
        new Response(JSON.stringify(payload), { status: ok ? 200 : 500 }) as unknown as Response,
    );
  }

  it('invia i tre comandi in una sola pipeline', async () => {
    const fetchImpl = fetchStub([{ result: 3 }, { result: 1 }, { result: '7' }]);
    const store = new UpstashRateLimitStore({
      url: 'https://esempio.upstash.io/',
      token: 'segreto',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const counts = await store.bump('omniagent:rl:audit:abc', 42, 120_000);

    expect(counts).toEqual({ current: 3, previous: 7 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://esempio.upstash.io/pipeline');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer segreto');

    const body = JSON.parse(String(init.body)) as string[][];
    expect(body[0]).toEqual(['INCR', 'omniagent:rl:audit:abc:42']);
    // `NX` è la parte che conta: senza, la scadenza si rinnoverebbe a ogni
    // richiesta e la finestra non si chiuderebbe mai.
    expect(body[1]).toEqual(['PEXPIRE', 'omniagent:rl:audit:abc:42', '120000', 'NX']);
    expect(body[2]).toEqual(['GET', 'omniagent:rl:audit:abc:41']);
  });

  it('interpreta una finestra precedente assente come zero', async () => {
    const store = new UpstashRateLimitStore({
      url: 'https://esempio.upstash.io',
      token: 't',
      fetchImpl: fetchStub([{ result: 1 }, { result: 1 }, { result: null }]) as unknown as typeof fetch,
    });
    expect(await store.bump('k', 1, 1_000)).toEqual({ current: 1, previous: 0 });
  });

  it('solleva su risposta non riuscita, così il chiamante può ripiegare', async () => {
    const store = new UpstashRateLimitStore({
      url: 'https://esempio.upstash.io',
      token: 't',
      fetchImpl: fetchStub({}, false) as unknown as typeof fetch,
    });
    await expect(store.bump('k', 1, 1_000)).rejects.toThrow('500');
  });

  it('solleva su risposta di forma inattesa invece di leggere zeri', async () => {
    const store = new UpstashRateLimitStore({
      url: 'https://esempio.upstash.io',
      token: 't',
      fetchImpl: fetchStub({ inatteso: true }) as unknown as typeof fetch,
    });
    await expect(store.bump('k', 1, 1_000)).rejects.toThrow('inatteso');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Decisione
// ─────────────────────────────────────────────────────────────────────────────

describe('checkRateLimit', () => {
  const identity = { kind: 'ip' as const, value: '203.0.113.7' };
  const policy = { name: 'test', limit: 3, windowMs: 60_000 };
  // A metà finestra il peso della precedente è dimezzato: si parte dal confine
  // per rendere il conteggio leggibile nei test.
  const now = () => 600_000;

  it('lascia passare finché la quota non è esaurita', async () => {
    const store = new MemoryRateLimitStore();
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const decision = await checkRateLimit(identity, policy, { store, salt: SALT, now });
      expect(decision.allowed).toBe(true);
      expect(decision.remaining).toBe(3 - attempt);
    }
  });

  it('nega la richiesta oltre la quota', async () => {
    const store = new MemoryRateLimitStore();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await checkRateLimit(identity, policy, { store, salt: SALT, now });
    }
    const decision = await checkRateLimit(identity, policy, { store, salt: SALT, now });

    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('applica il moltiplicatore a chi si presenta con un token', async () => {
    const store = new MemoryRateLimitStore();
    const decision = await checkRateLimit({ kind: 'token', value: 'chiave-lunga' }, policy, {
      store,
      salt: SALT,
      now,
    });
    expect(decision.limit).toBe(3 * TOKEN_QUOTA_MULTIPLIER);
  });

  it('tiene separati due chiamanti diversi', async () => {
    const store = new MemoryRateLimitStore();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await checkRateLimit(identity, policy, { store, salt: SALT, now });
    }
    const altro = await checkRateLimit({ kind: 'ip', value: '198.51.100.1' }, policy, {
      store,
      salt: SALT,
      now,
    });
    expect(altro.allowed).toBe(true);
  });

  it('con Redis irraggiungibile ripiega in memoria invece di aprire', async () => {
    // Aprire lascerebbe la spesa in token senza argine proprio quando
    // l'infrastruttura è già in difficoltà; chiudere spegnerebbe il prodotto
    // per un guasto in un componente accessorio.
    const rotto: RateLimitStore = {
      backend: 'upstash',
      bump: vi.fn(async () => {
        throw new Error('rete non raggiungibile');
      }),
    };
    const fallbackStore = new MemoryRateLimitStore();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const decision = await checkRateLimit(identity, policy, {
        store: rotto,
        fallbackStore,
        salt: SALT,
        now,
      });
      expect(decision.allowed).toBe(true);
      expect(decision.degraded).toBe(true);
      expect(decision.backend).toBe('memory');
    }

    const oltre = await checkRateLimit(identity, policy, {
      store: rotto,
      fallbackStore,
      salt: SALT,
      now,
    });
    expect(oltre.allowed).toBe(false);
  });

  it('dichiara degradato il conteggio in memoria: non è distribuito', async () => {
    const decision = await checkRateLimit(identity, policy, {
      store: new MemoryRateLimitStore(),
      salt: SALT,
      now,
    });
    expect(decision.degraded).toBe(true);
    expect(decision.backend).toBe('memory');
  });

  it('non dichiara degradato un conteggio su Redis', async () => {
    const store: RateLimitStore = {
      backend: 'upstash',
      bump: vi.fn(async () => ({ current: 1, previous: 0 })),
    };
    const decision = await checkRateLimit(identity, policy, { store, salt: SALT, now });
    expect(decision.degraded).toBe(false);
  });
});

describe('policyForPath', () => {
  it('non limita ciò che non è API', () => {
    expect(policyForPath('/')).toBeNull();
    expect(policyForPath('/audit')).toBeNull();
  });

  it('lascia sempre raggiungibile la diagnostica', () => {
    // È l'endpoint che dice se il sistema è configurato: serve proprio quando
    // qualcosa va storto, cioè quando i limiti stanno scattando.
    expect(policyForPath('/api/health')).toBeNull();
  });

  it('assegna la quota più stretta all\'audit, che è la rotta più costosa', () => {
    expect(policyForPath('/api/audit')?.name).toBe('audit');
    expect(RATE_LIMIT_POLICIES.audit.limit).toBeLessThan(RATE_LIMIT_POLICIES.chat.limit);
  });

  it('assegna una politica a ogni rotta nota e un default alle altre', () => {
    expect(policyForPath('/api/chat')?.name).toBe('chat');
    expect(policyForPath('/api/extract')?.name).toBe('extract');
    expect(policyForPath('/api/qualcosa-di-nuovo')?.name).toBe('default');
  });
});

describe('rateLimitHeaders', () => {
  const base = {
    limit: 10,
    remaining: 4,
    resetAt: Date.now() + 30_000,
    retryAfterSeconds: 30,
    backend: 'upstash' as const,
    policy: 'audit',
    identityKind: 'ip' as const,
  };

  it('espone la quota così che un client possa autoregolarsi', () => {
    const result = rateLimitHeaders({ ...base, allowed: true, degraded: false });
    expect(result['ratelimit-limit']).toBe('10');
    expect(result['ratelimit-remaining']).toBe('4');
    expect(result['retry-after']).toBeUndefined();
  });

  it('aggiunge retry-after solo quando la richiesta è negata', () => {
    const result = rateLimitHeaders({ ...base, allowed: false, degraded: false });
    expect(result['retry-after']).toBe('30');
  });

  it('dichiara il conteggio degradato', () => {
    const result = rateLimitHeaders({ ...base, allowed: true, degraded: true });
    expect(result['x-ratelimit-degraded']).toBe('true');
  });
});
