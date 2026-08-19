import { readEnv } from '@/lib/env';

/**
 * Sessioni come cookie firmato, senza tabella.
 *
 * **Perché senza stato.** Una tabella di sessioni impone una query al database
 * su *ogni* richiesta autenticata, compresa la navigazione fra pagine. Su Edge,
 * dove il resto della latenza si misura in decine di millisecondi, quella query
 * diventa la voce dominante. Il cookie firmato costa una verifica HMAC locale,
 * cioè microsecondi.
 *
 * **Il prezzo, e come si paga.** Un token senza stato non si può revocare
 * singolarmente: resta valido fino alla scadenza. Si compensa su due fronti —
 * durata contenuta (sette giorni) e `sessionVersion`, un contatore sull'utente
 * che un cambio password incrementa. Da quel momento tutti i token emessi prima
 * non superano più la verifica, che è esattamente il comportamento atteso dopo
 * un "sono stato compromesso". La verifica del contatore costa una lettura del
 * record utente, quindi la si fa dove serve davvero — nelle rotte che agiscono
 * — non nel middleware, che deve restare leggero.
 */

export const SESSION_COOKIE = 'omniagent_session';
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionPayload {
  /** Utente. */
  readonly uid: string;
  /** Organizzazione attiva. */
  readonly oid: string;
  /** Versione di sessione dell'utente al momento dell'emissione. */
  readonly sv: number;
  /** Scadenza, secondi epoch. */
  readonly exp: number;
}

export class SessionSecretMissingError extends Error {
  readonly code = 'session_secret_missing';
  constructor() {
    super(
      'SESSION_SECRET non è configurata. Genera un valore casuale di almeno 32 caratteri: ' +
        'senza, le sessioni non possono essere firmate.',
    );
    this.name = 'SessionSecretMissingError';
  }
}

/**
 * Segreto di firma.
 *
 * **Nessun ripiego su un valore di sviluppo.** Altrove in questa applicazione un
 * default degradato è la scelta giusta — il vector store ripiega su un corpus
 * dimostrativo e lo dichiara. Qui no: un segreto di ripiego finirebbe nel
 * repository, e chiunque lo legga potrebbe firmarsi una sessione per qualunque
 * utente di qualunque installazione che non l'ha sovrascritto. Meglio che
 * l'autenticazione si rifiuti di partire.
 */
function getSecret(): string {
  const secret = readEnv('SESSION_SECRET');
  if (secret === undefined || secret.length < 32) throw new SessionSecretMissingError();
  return secret;
}

export function isSessionConfigured(): boolean {
  const secret = readEnv('SESSION_SECRET');
  return secret !== undefined && secret.length >= 32;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function createSessionToken(
  input: Omit<SessionPayload, 'exp'>,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  now: number = Date.now(),
): Promise<string> {
  const payload: SessionPayload = {
    ...input,
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const encoded = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encoded, getSecret());
  return `${encoded}.${signature}`;
}

/**
 * Verifica un token.
 *
 * Restituisce `null` per qualunque motivo di fallimento — firma non valida,
 * scaduto, malformato — senza distinguerli. Un messaggio che dicesse "firma
 * valida ma scaduto" confermerebbe a chi sta provando che il segreto indovinato
 * è quello giusto.
 */
export async function verifySessionToken(
  token: string | undefined | null,
  now: number = Date.now(),
): Promise<SessionPayload | null> {
  if (token === undefined || token === null || token.length === 0) return null;

  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);

  let expected: string;
  try {
    expected = await sign(encoded, getSecret());
  } catch {
    return null;
  }

  // Confronto a tempo costante sulla firma, come per le password.
  if (signature.length !== expected.length) return null;
  let diff = 0;
  for (let index = 0; index < signature.length; index += 1) {
    diff |= signature.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  if (diff !== 0) return null;

  try {
    const payload: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(encoded)));
    if (typeof payload !== 'object' || payload === null) return null;

    const { uid, oid, sv, exp } = payload as Record<string, unknown>;
    if (typeof uid !== 'string' || typeof oid !== 'string') return null;
    if (typeof sv !== 'number' || typeof exp !== 'number') return null;
    if (exp * 1000 <= now) return null;

    return { uid, oid, sv, exp };
  } catch {
    return null;
  }
}

/** Attributi del cookie di sessione. */
export function sessionCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    // `lax` e non `strict`: con `strict` chi arriva da un link esterno — una
    // mail di invito, un risultato di ricerca — atterrerebbe disconnesso pur
    // avendo una sessione valida. `lax` copre comunque le richieste POST
    // cross-site, che sono il vettore CSRF che conta.
    sameSite: 'lax' as const,
    secure: true,
    path: '/',
    maxAge,
  };
}
