/**
 * Token opachi per inviti e reimpostazione password.
 *
 * **Il token viaggia in chiaro nel link, in archivio finisce solo il digest.**
 * È la stessa proprietà delle password: chi legge il database non deve poterne
 * ricavare un accesso. Un token di invito in chiaro è un ingresso nel workspace
 * di un cliente; un token di reset in chiaro è l'accesso a ogni account, e sono
 * entrambi leggibili da qualunque backup, da un log di query o da chiunque abbia
 * accesso in sola lettura.
 *
 * **Qui basta SHA-256 senza sale, e la differenza rispetto alle password conta.**
 * Una password è scelta da un umano, ha entropia bassa e si attacca con un
 * dizionario: per questo richiede PBKDF2 con centinaia di migliaia di iterazioni
 * e un sale per record. Questi token sono 256 bit da un generatore
 * crittografico: non esiste dizionario da provare, e rallentare il digest
 * proteggerebbe da un attacco che non è possibile, pagandolo su ogni verifica.
 */

/** Byte di entropia. 32 byte = 256 bit: oltre la soglia di qualunque forza bruta. */
export const TOKEN_BYTES = 32;

/** Durata di un invito. Una settimana copre un rientro dalle ferie senza restare aperto per sempre. */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Durata di un token di reimpostazione.
 *
 * Un'ora, non un giorno: il link finisce in una casella di posta, e una casella
 * di posta è il primo posto che qualcuno controlla quando ha accesso temporaneo
 * a un dispositivo altrui. La finestra deve bastare a leggere l'email e cliccare,
 * non a essere ritrovata la settimana dopo.
 */
export const RESET_TTL_MS = 60 * 60 * 1000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Genera un token opaco, adatto a comparire in un URL. */
export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(TOKEN_BYTES)));
}

/** Digest esadecimale del token: è l'unica forma che tocca il database. */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

/** Costruisce il link da mettere nell'email. */
export function buildTokenUrl(baseUrl: string, path: string, token: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  return `${normalized}${path}/${encodeURIComponent(token)}`;
}
