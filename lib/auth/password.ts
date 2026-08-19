/**
 * Hashing delle password.
 *
 * **PBKDF2-HMAC-SHA256 e non bcrypt o Argon2id, per un vincolo di runtime.**
 * Argon2id è la scelta migliore in assoluto e resta la raccomandazione OWASP;
 * bcrypt è l'alternativa consolidata. Nessuno dei due gira su Edge runtime senza
 * trascinarsi dietro un modulo WASM, e tutta l'applicazione sta su Edge per
 * ragioni di latenza e di residenza dei dati. PBKDF2 è nella Web Crypto API,
 * quindi è nativo, non ha dipendenze e non ha un'implementazione JavaScript
 * lenta a fare da ripiego.
 *
 * Il prezzo è che PBKDF2 si difende peggio dalle GPU: si compensa con il numero
 * di iterazioni raccomandato da OWASP per SHA-256, 600.000. Il formato è
 * versionato proprio perché quel numero è destinato a salire, e `needsRehash()`
 * permette di aggiornare le password esistenti al login successivo senza
 * chiedere nulla all'utente.
 *
 * Se un giorno l'applicazione lasciasse Edge, la migrazione ad Argon2id passa
 * da qui e da nessun altro punto del codice.
 */

/** Iterazioni raccomandate da OWASP per PBKDF2-HMAC-SHA256 (2024). */
export const PBKDF2_ITERATIONS = 600_000;

/** Lunghezza del sale, in byte. */
export const SALT_BYTES = 16;

/** Lunghezza della chiave derivata, in bit. */
export const KEY_BITS = 256;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 200;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Produce un hash verificabile.
 *
 * Il formato `pbkdf2$iterazioni$sale$hash` è autodescrittivo: contiene tutto ciò
 * che serve a verificarlo, quindi cambiare le iterazioni non invalida le
 * password già memorizzate.
 */
export async function hashPassword(
  password: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Confronto a tempo costante.
 *
 * Un `===` fra stringhe esce al primo byte diverso, e la differenza di tempo fra
 * un hash sbagliato al primo carattere e uno sbagliato all'ultimo è misurabile
 * sulla rete. Non è l'attacco più pratico del mondo, ma costa quattro righe
 * evitarlo.
 */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;

  const iterations = Number.parseInt(parts[1] ?? '', 10);
  if (!Number.isFinite(iterations) || iterations < 1_000) return false;

  try {
    const salt = fromBase64(parts[2] ?? '');
    const expected = fromBase64(parts[3] ?? '');
    const actual = await derive(password, salt, iterations);
    return timingSafeEqual(actual, expected);
  } catch {
    // Hash malformato in archivio: si nega l'accesso, non si lancia. Un errore
    // qui distinguerebbe "record corrotto" da "password sbagliata" per chi sta
    // provando a indovinare.
    return false;
  }
}

/** True se l'hash è stato prodotto con meno iterazioni di quelle attuali. */
export function needsRehash(stored: string, target: number = PBKDF2_ITERATIONS): boolean {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return true;
  const iterations = Number.parseInt(parts[1] ?? '', 10);
  return !Number.isFinite(iterations) || iterations < target;
}

export interface PasswordCheck {
  readonly ok: boolean;
  readonly message: string | null;
}

/**
 * Requisiti minimi.
 *
 * Lunghezza e non composizione forzata. Imporre "una maiuscola, un numero e un
 * simbolo" produce `Password1!` — che soddisfa la regola ed è fra le prime
 * cento di ogni dizionario — mentre una passphrase lunga e memorabile la
 * violerebbe. Il NIST ha smesso di raccomandare le regole di composizione nel
 * 2017 proprio per questo.
 */
export function checkPasswordStrength(password: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri. Una frase che ricordi è più sicura di una parola con simboli.`,
    };
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return { ok: false, message: `La password non può superare ${MAX_PASSWORD_LENGTH} caratteri.` };
  }
  // Un solo carattere ripetuto supera qualunque controllo di lunghezza.
  if (new Set(password).size < 5) {
    return { ok: false, message: 'La password è troppo ripetitiva: usa più caratteri diversi.' };
  }
  return { ok: true, message: null };
}
