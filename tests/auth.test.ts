import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkPasswordStrength,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  needsRehash,
  PBKDF2_ITERATIONS,
  verifyPassword,
} from '@/lib/auth/password';
import {
  createSessionToken,
  isSessionConfigured,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from '@/lib/auth/session';
import { normalizeEmail } from '@/lib/auth/repository';
import { contractKeyFor } from '@/lib/audits/repository';

/**
 * Test di autenticazione.
 *
 * Le iterazioni PBKDF2 di produzione sono 600.000: eseguirle in una dozzina di
 * casi renderebbe la suite inutilizzabile, e una suite lenta smette di essere
 * eseguita. I test usano un valore basso passato esplicitamente, che è possibile
 * solo perché il formato dell'hash porta con sé le proprie iterazioni — la
 * stessa proprietà che permetterà di alzarle in produzione senza invalidare le
 * password esistenti.
 */

const FAST_ITERATIONS = 1_000;

describe('hashPassword / verifyPassword', () => {
  it('verifica la password corretta', async () => {
    const hash = await hashPassword('passphrase-lunga-e-memorabile', FAST_ITERATIONS);
    expect(await verifyPassword('passphrase-lunga-e-memorabile', hash)).toBe(true);
  });

  it('rifiuta la password sbagliata', async () => {
    const hash = await hashPassword('passphrase-lunga-e-memorabile', FAST_ITERATIONS);
    expect(await verifyPassword('passphrase-lunga-e-memorabil', hash)).toBe(false);
  });

  it('produce hash diversi per la stessa password: il sale è per record', async () => {
    // Senza sale per record, due utenti con la stessa password avrebbero lo
    // stesso hash — e un solo attacco riuscito ne aprirebbe due.
    const first = await hashPassword('stessa-password-qui', FAST_ITERATIONS);
    const second = await hashPassword('stessa-password-qui', FAST_ITERATIONS);
    expect(first).not.toBe(second);
    expect(await verifyPassword('stessa-password-qui', first)).toBe(true);
    expect(await verifyPassword('stessa-password-qui', second)).toBe(true);
  });

  it('scrive nel formato autodescrittivo, iterazioni comprese', async () => {
    const hash = await hashPassword('passphrase-di-prova', FAST_ITERATIONS);
    const parts = hash.split('$');
    expect(parts[0]).toBe('pbkdf2');
    expect(Number(parts[1])).toBe(FAST_ITERATIONS);
    expect(parts).toHaveLength(4);
  });

  it('verifica un hash prodotto con iterazioni diverse dalle attuali', async () => {
    // È ciò che rende possibile alzare il costo senza invalidare gli account.
    const old = await hashPassword('passphrase-storica', 2_000);
    expect(await verifyPassword('passphrase-storica', old)).toBe(true);
  });

  it('nega l\'accesso su un hash malformato invece di lanciare', async () => {
    // Un errore distinguerebbe "record corrotto" da "password sbagliata" per chi
    // sta provando a indovinare.
    for (const malformed of ['', 'non-un-hash', 'pbkdf2$abc$xx$yy', 'bcrypt$1$a$b']) {
      expect(await verifyPassword('qualsiasi', malformed)).toBe(false);
    }
  });

  it('rifiuta un hash con iterazioni implausibilmente basse', async () => {
    const weak = await hashPassword('passphrase-di-prova', FAST_ITERATIONS);
    const tampered = weak.replace(/^pbkdf2\$\d+/, 'pbkdf2$1');
    expect(await verifyPassword('passphrase-di-prova', tampered)).toBe(false);
  });
});

describe('needsRehash', () => {
  it('segnala gli hash sotto il costo corrente', async () => {
    const old = await hashPassword('passphrase-di-prova', FAST_ITERATIONS);
    expect(needsRehash(old)).toBe(true);
    expect(needsRehash(old, FAST_ITERATIONS)).toBe(false);
  });

  it('considera da rifare qualunque formato non riconosciuto', () => {
    expect(needsRehash('bcrypt$2b$12$abc')).toBe(true);
  });

  it('il costo di produzione è quello raccomandato da OWASP', () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
  });
});

describe('checkPasswordStrength', () => {
  it('accetta una passphrase lunga senza simboli', () => {
    // Le regole di composizione producono `Password1!`; il NIST le ha
    // abbandonate nel 2017 proprio per questo.
    expect(checkPasswordStrength('cavallo batteria graffetta').ok).toBe(true);
  });

  it('rifiuta una password troppo corta', () => {
    const result = checkPasswordStrength('a'.repeat(MIN_PASSWORD_LENGTH - 1));
    expect(result.ok).toBe(false);
    expect(result.message).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it('rifiuta una password lunga ma ripetitiva', () => {
    expect(checkPasswordStrength('aaaaaaaaaaaaaaaaaaaa').ok).toBe(false);
  });

  it('rifiuta una password oltre il limite di lunghezza', () => {
    expect(checkPasswordStrength('x'.repeat(500)).ok).toBe(false);
  });
});

describe('sessioni', () => {
  const previous = process.env.SESSION_SECRET;

  beforeEach(() => {
    process.env.SESSION_SECRET = 'un-segreto-di-test-lungo-almeno-32-caratteri';
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  });

  it('emette e verifica un token valido', async () => {
    const token = await createSessionToken({ uid: 'usr_1', oid: 'org_1', sv: 3 });
    const payload = await verifySessionToken(token);
    expect(payload).toMatchObject({ uid: 'usr_1', oid: 'org_1', sv: 3 });
  });

  it('rifiuta un token con firma manomessa', async () => {
    const token = await createSessionToken({ uid: 'usr_1', oid: 'org_1', sv: 1 });
    expect(await verifySessionToken(`${token.slice(0, -2)}xy`)).toBeNull();
  });

  it('rifiuta un payload manomesso: cambiare organizzazione invalida la firma', async () => {
    // È l'attacco che conta: riscrivere `oid` per leggere gli audit di un altro
    // workspace. Il payload è firmato, non solo codificato.
    const token = await createSessionToken({ uid: 'usr_1', oid: 'org_1', sv: 1 });
    const [encoded, signature] = token.split('.');
    const decoded = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob((encoded ?? '').replace(/-/g, '+').replace(/_/g, '/')), (c) =>
          c.charCodeAt(0),
        ),
      ),
    ) as Record<string, unknown>;
    decoded.oid = 'org_vittima';
    const forged = btoa(JSON.stringify(decoded))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    expect(await verifySessionToken(`${forged}.${signature}`)).toBeNull();
  });

  it('rifiuta un token scaduto', async () => {
    const token = await createSessionToken({ uid: 'usr_1', oid: 'org_1', sv: 1 }, 60, Date.now());
    expect(await verifySessionToken(token, Date.now() + 61_000)).toBeNull();
  });

  it('rifiuta valori vuoti o malformati senza lanciare', async () => {
    for (const value of [undefined, null, '', 'senza-punto', 'a.b.c']) {
      expect(await verifySessionToken(value)).toBeNull();
    }
  });

  it('un segreto diverso non verifica il token: la firma dipende dal segreto', async () => {
    const token = await createSessionToken({ uid: 'usr_1', oid: 'org_1', sv: 1 });
    process.env.SESSION_SECRET = 'un-altro-segreto-lungo-almeno-32-caratteri!!';
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('senza segreto configurato la verifica fallisce invece di accettare', async () => {
    const token = await createSessionToken({ uid: 'usr_1', oid: 'org_1', sv: 1 });
    delete process.env.SESSION_SECRET;
    expect(isSessionConfigured()).toBe(false);
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rifiuta un segreto troppo corto per essere sicuro', () => {
    process.env.SESSION_SECRET = 'corto';
    expect(isSessionConfigured()).toBe(false);
  });

  it('la durata predefinita è di sette giorni', () => {
    expect(SESSION_TTL_SECONDS).toBe(7 * 24 * 60 * 60);
  });
});

describe('normalizeEmail', () => {
  it('uniforma maiuscole e spazi', () => {
    // Senza, `Mario@Acme.it` e `mario@acme.it` diventerebbero due account e il
    // primo registrato non riuscirebbe più a entrare.
    expect(normalizeEmail('  Mario@Acme.IT ')).toBe('mario@acme.it');
  });
});

describe('contractKeyFor', () => {
  it('riconosce come stesso contratto due versioni con numerazione diversa', () => {
    expect(contractKeyFor('Contratto Nordwind v2.pdf')).toBe(
      contractKeyFor('Contratto Nordwind v3.pdf'),
    );
  });

  it('ignora suffissi di revisione e date', () => {
    expect(contractKeyFor('Accordo Acme - bozza 2026.docx')).toBe(
      contractKeyFor('Accordo Acme FIRMATO.pdf'),
    );
  });

  it('tiene distinti contratti di fornitori diversi', () => {
    expect(contractKeyFor('Contratto Nordwind v2.pdf')).not.toBe(
      contractKeyFor('Contratto Acme v2.pdf'),
    );
  });

  it('normalizza accenti e maiuscole', () => {
    expect(contractKeyFor('Fornitura Città')).toBe(contractKeyFor('fornitura citta'));
  });

  it('NON prova a interpretare le abbreviazioni societarie', () => {
    // "S.p.A." diventa "s-p-a", non "spa": la punteggiatura è un separatore.
    // È deliberato — normalizzare di più significherebbe rischiare di unire due
    // contratti diversi, che è un errore peggiore del non unirne due uguali:
    // un raggruppamento sbagliato mostra un confronto fra documenti che non
    // hanno nulla in comune, e chi lo legge non ha modo di accorgersene.
    expect(contractKeyFor('Fornitura S.p.A.')).toBe('fornitura-s-p-a');
    expect(contractKeyFor('Fornitura SpA')).toBe('fornitura-spa');
  });

  it('regge un nome vuoto senza produrre una chiave assurda', () => {
    expect(contractKeyFor('')).toBe('');
  });
});
