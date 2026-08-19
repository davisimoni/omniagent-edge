import { cookies } from 'next/headers';
import { loadAccount, type AuthenticatedAccount } from '@/lib/auth/repository';
import { SESSION_COOKIE, isSessionConfigured, verifySessionToken } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';

/**
 * Identità della richiesta corrente, lato server.
 *
 * **Due livelli, non uno.** `readSession()` verifica solo la firma del cookie:
 * costa una HMAC locale e basta a decidere se mostrare "Accedi" o il nome
 * dell'utente. `getCurrentAccount()` legge anche il record dal database, che è
 * l'unico modo per accorgersi che l'utente ha cambiato password o è stato
 * rimosso dal workspace dopo l'emissione del token.
 *
 * La distinzione conta: chiamare sempre la versione costosa aggiungerebbe una
 * query al database a ogni render di ogni pagina, anche a quelle che dell'utente
 * mostrano solo il nome. Le rotte che **agiscono** — creano un audit, cambiano
 * un piano, assegnano una revisione — usano sempre la versione completa.
 */

export async function readSession() {
  if (!isSessionConfigured()) return null;
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/**
 * Account completo, validato contro il database.
 *
 * Restituisce `null` senza lanciare quando manca la configurazione: le pagine
 * pubbliche devono poter girare anche su un'installazione senza database, e un
 * errore qui le renderebbe tutte inaccessibili invece di mostrarle disconnesse.
 */
export async function getCurrentAccount(): Promise<AuthenticatedAccount | null> {
  if (!isDatabaseConfigured() || !isSessionConfigured()) return null;

  const session = await readSession();
  if (session === null) return null;

  try {
    return await loadAccount(session.uid, session.oid, session.sv);
  } catch (error) {
    console.error('[auth] impossibile caricare l\'account della sessione', error);
    return null;
  }
}

/** True quando registrazione e accesso sono utilizzabili su questa installazione. */
export function isAuthAvailable(): boolean {
  return isDatabaseConfigured() && isSessionConfigured();
}

/** Motivo per cui l'autenticazione non è disponibile, per un messaggio azionabile. */
export function authUnavailableReason(): string | null {
  if (!isDatabaseConfigured()) {
    return 'DATABASE_URL non è configurata: gli account richiedono un database PostgreSQL.';
  }
  if (!isSessionConfigured()) {
    return 'SESSION_SECRET non è configurata (servono almeno 32 caratteri casuali).';
  }
  return null;
}
