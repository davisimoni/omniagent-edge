import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildTokenUrl,
  generateToken,
  hashToken,
  INVITE_TTL_MS,
  RESET_TTL_MS,
  TOKEN_BYTES,
} from '@/lib/auth/tokens';
import { computeSeatUsage } from '@/lib/auth/invitations';
import { emailFrom, isEmailConfigured, sendEmail } from '@/lib/email/send';
import { createPortalSession } from '@/lib/billing/stripe';
import { PLANS } from '@/lib/billing/plans';

/**
 * Test di token, postazioni, email e portale clienti.
 *
 * Il gruppo sulle postazioni è quello che protegge il ricavo: contare solo i
 * membri effettivi renderebbe il limite del piano aggirabile generando dieci
 * inviti di fila e accettandoli dopo.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Token
// ─────────────────────────────────────────────────────────────────────────────

describe('token opachi', () => {
  it('genera valori diversi a ogni chiamata', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateToken()));
    expect(tokens.size).toBe(50);
  });

  it('ha entropia sufficiente da rendere la forza bruta irrilevante', () => {
    expect(TOKEN_BYTES).toBeGreaterThanOrEqual(32);
    // base64url di 32 byte: 43 caratteri senza riempimento.
    expect(generateToken()).toHaveLength(43);
  });

  it('produce token utilizzabili in un URL senza codifica', () => {
    for (let index = 0; index < 20; index += 1) {
      expect(generateToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('il digest è deterministico e non contiene il token', async () => {
    const token = generateToken();
    const digest = await hashToken(token);
    expect(await hashToken(token)).toBe(digest);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(token);
  });

  it('token diversi producono digest diversi', async () => {
    expect(await hashToken(generateToken())).not.toBe(await hashToken(generateToken()));
  });

  it('un invito dura sette giorni, una reimpostazione un\'ora', () => {
    // Il link di reset finisce in una casella di posta, che è il primo posto
    // che qualcuno controlla con accesso temporaneo a un dispositivo altrui.
    expect(INVITE_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(RESET_TTL_MS).toBe(60 * 60 * 1000);
    expect(RESET_TTL_MS).toBeLessThan(INVITE_TTL_MS);
  });
});

describe('buildTokenUrl', () => {
  it('compone un link assoluto', () => {
    expect(buildTokenUrl('https://app.test', '/invite', 'abc')).toBe('https://app.test/invite/abc');
  });

  it('non produce doppie barre su una base con barra finale', () => {
    expect(buildTokenUrl('https://app.test/', '/invite', 'abc')).toBe(
      'https://app.test/invite/abc',
    );
  });

  it('codifica il token nel percorso', () => {
    expect(buildTokenUrl('https://app.test', '/reset-password', 'a b')).toContain('a%20b');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Postazioni
// ─────────────────────────────────────────────────────────────────────────────

describe('computeSeatUsage', () => {
  it('conta gli inviti aperti insieme ai membri', () => {
    // Senza, si generano cinque inviti su un piano da cinque posti e il limite
    // salta al momento dell'accettazione — addossando l'errore a chi entra.
    const usage = computeSeatUsage('pro', 3, 2);
    expect(usage.used).toBe(5);
    expect(usage.limit).toBe(PLANS.pro.seats);
    expect(usage.remaining).toBe(0);
  });

  it('riporta le postazioni residue', () => {
    const usage = computeSeatUsage('pro', 2, 0);
    expect(usage.remaining).toBe(3);
  });

  it('non produce residui negativi quando il limite è già superato', () => {
    // Può accadere legittimamente dopo un declassamento di piano.
    const usage = computeSeatUsage('free', 4, 1);
    expect(usage.used).toBe(5);
    expect(usage.remaining).toBe(0);
  });

  it('il piano Free ha una sola postazione', () => {
    expect(computeSeatUsage('free', 1, 0).remaining).toBe(0);
    expect(computeSeatUsage('free', 0, 0).remaining).toBe(1);
  });

  it('Enterprise non pone limiti', () => {
    const usage = computeSeatUsage('enterprise', 200, 30);
    expect(usage.limit).toBeNull();
    expect(usage.remaining).toBeNull();
  });

  it('un piano ignoto ripiega sui limiti di Free, non su nessun limite', () => {
    const usage = computeSeatUsage('platinum' as never, 0, 0);
    expect(usage.limit).toBe(PLANS.free.seats);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Email
// ─────────────────────────────────────────────────────────────────────────────

describe('sendEmail', () => {
  // `vi.stubEnv` invece di scrivere su `process.env`: NODE_ENV è esposta con un
  // descrittore non riconfigurabile, e assegnarla direttamente lancia.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('senza fornitore dichiara di non aver inviato', async () => {
    vi.stubEnv('EMAIL_API_URL', '');
    const result = await sendEmail({ to: ['a@b.test'], subject: 'x', text: 'y' });

    expect(result.delivered).toBe(false);
    expect(result.reason).toContain('EMAIL_API_URL');
    expect(isEmailConfigured()).toBe(false);
  });

  it('fuori produzione restituisce il contenuto, per non bloccare il flusso locale', async () => {
    vi.stubEnv('EMAIL_API_URL', '');
    vi.stubEnv('NODE_ENV', 'development');

    const result = await sendEmail({ to: ['a@b.test'], subject: 'Oggetto', text: 'Corpo' });
    expect(result.devPreview).toEqual({ subject: 'Oggetto', text: 'Corpo' });
  });

  it('in produzione NON restituisce il contenuto', async () => {
    // Sarebbe consegnare un link di reimpostazione a chiunque conosca un'email.
    vi.stubEnv('EMAIL_API_URL', '');
    vi.stubEnv('NODE_ENV', 'production');

    const result = await sendEmail({ to: ['a@b.test'], subject: 'Oggetto', text: 'Corpo' });
    expect(result.devPreview).toBeNull();
  });

  it('inoltra il messaggio al fornitore configurato', async () => {
    vi.stubEnv('EMAIL_API_URL', 'https://api.posta.test/emails');
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }) as unknown as Response);

    const result = await sendEmail(
      { to: ['a@b.test', 'c@d.test'], subject: 'Oggetto', text: 'Corpo' },
      fetchImpl as unknown as typeof fetch,
    );

    expect(result.delivered).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.posta.test/emails');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.to).toEqual(['a@b.test', 'c@d.test']);
    expect(body.subject).toBe('Oggetto');
    expect(body.from).toBe(emailFrom());
  });

  it('riporta un rifiuto del fornitore senza lanciare', async () => {
    vi.stubEnv('EMAIL_API_URL', 'https://api.posta.test/emails');
    const fetchImpl = vi.fn(async () => new Response('no', { status: 422 }) as unknown as Response);

    const result = await sendEmail(
      { to: ['a@b.test'], subject: 'x', text: 'y' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toContain('422');
  });

  it('riporta un errore di rete senza lanciare', async () => {
    vi.stubEnv('EMAIL_API_URL', 'https://api.posta.test/emails');
    const fetchImpl = vi.fn(async () => {
      throw new Error('rete non raggiungibile');
    });

    const result = await sendEmail(
      { to: ['a@b.test'], subject: 'x', text: 'y' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(result.delivered).toBe(false);
    expect(result.reason).toContain('rete');
  });

  it('il mittente di ripiego non è un dominio reale altrui', () => {
    expect(emailFrom()).toContain('.invalid');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Portale clienti
// ─────────────────────────────────────────────────────────────────────────────

describe('createPortalSession', () => {
  beforeEach(() => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_chiave');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('chiede a Stripe una sessione per il cliente indicato', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ url: 'https://billing.stripe.test/session' }), {
          status: 200,
        }) as unknown as Response,
    );

    const session = await createPortalSession({
      customerId: 'cus_123',
      returnUrl: 'https://app.test/settings',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(session.url).toBe('https://billing.stripe.test/session');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/billing_portal/sessions');
    expect(String(init.body)).toContain('customer=cus_123');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk_test_chiave');
  });

  it('solleva quando Stripe rifiuta', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('errore', { status: 400 }) as unknown as Response,
    );
    await expect(
      createPortalSession({
        customerId: 'cus_123',
        returnUrl: 'https://app.test/settings',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('400');
  });

  it('solleva quando la risposta non contiene un URL', async () => {
    const fetchImpl = vi.fn(
      async () => new Response('{}', { status: 200 }) as unknown as Response,
    );
    await expect(
      createPortalSession({
        customerId: 'cus_123',
        returnUrl: 'https://app.test/settings',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('URL');
  });

  it('senza chiave configurata non tenta la chiamata', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', '');
    const fetchImpl = vi.fn();

    await expect(
      createPortalSession({
        customerId: 'cus_123',
        returnUrl: 'https://app.test/settings',
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow('STRIPE_SECRET_KEY');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
