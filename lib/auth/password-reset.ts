import { getSql, newId } from '@/lib/db/client';
import { changePassword, normalizeEmail } from '@/lib/auth/repository';
import { buildTokenUrl, generateToken, hashToken, RESET_TTL_MS } from '@/lib/auth/tokens';
import { sendEmail, type EmailResult } from '@/lib/email/send';

/**
 * Reimpostazione della password.
 *
 * **La risposta non rivela se l'email esista.** `requestPasswordReset` restituisce
 * lo stesso esito per un indirizzo registrato e per uno sconosciuto: la
 * differenza sarebbe un modo comodo per enumerare i clienti di un prodotto B2B,
 * cioè per sapere quali aziende usano questo servizio. L'unica cosa che cambia è
 * se un'email parte davvero.
 *
 * **Un token nuovo invalida i precedenti.** Chi clicca due volte "ho dimenticato
 * la password" riceve due link, e il primo deve smettere di funzionare: due
 * finestre aperte contemporaneamente raddoppiano il tempo in cui un accesso alla
 * casella di posta vale un accesso all'account.
 *
 * **Il consumo del token e il cambio password stanno insieme.** `consumeReset`
 * marca il token usato e cambia la password nella stessa operazione; il cambio
 * incrementa `session_version`, quindi ogni sessione aperta prima — compresa
 * quella di chi ha eventualmente rubato l'account — smette di valere.
 */

export interface ResetRequestOutcome {
  /** Sempre `true`: l'esito non distingue email note da ignote. */
  readonly accepted: true;
  /** `null` se l'indirizzo non risulta registrato o se non c'è fornitore di posta. */
  readonly email: EmailResult | null;
}

function buildResetEmail(link: string): { subject: string; text: string } {
  return {
    subject: 'Reimposta la password di OmniAgent Edge',
    text: [
      'Hai chiesto di reimpostare la password del tuo account OmniAgent Edge.',
      '',
      'Apri questo link per sceglierne una nuova:',
      link,
      '',
      'Il link scade fra un\'ora e può essere usato una sola volta.',
      '',
      'Se non hai richiesto tu questa operazione, puoi ignorare questo messaggio:',
      'la password attuale resta valida e nessuno vi ha avuto accesso.',
    ].join('\n'),
  };
}

export async function requestPasswordReset(
  email: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ResetRequestOutcome> {
  const sql = getSql();
  const normalized = normalizeEmail(email);

  const rows = await sql`SELECT id FROM users WHERE email = ${normalized} LIMIT 1`;
  const userId = rows[0]?.id;

  if (userId === undefined) {
    // Nessun token, nessuna email, stessa risposta. Il tempo di risposta differisce
    // di una query: non abbastanza da distinguere i due casi sulla rete.
    return { accepted: true, email: null };
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + RESET_TTL_MS).toISOString();

  // Invalida i token ancora aperti prima di emetterne uno nuovo.
  await sql`
    UPDATE password_resets
    SET used_at = now()
    WHERE user_id = ${String(userId)} AND used_at IS NULL`;

  await sql`
    INSERT INTO password_resets (id, user_id, token_hash, expires_at)
    VALUES (${newId('rst')}, ${String(userId)}, ${tokenHash}, ${expiresAt})`;

  const link = buildTokenUrl(baseUrl, '/reset-password', token);
  const { subject, text } = buildResetEmail(link);

  return { accepted: true, email: await sendEmail({ to: [normalized], subject, text }, fetchImpl) };
}

export type ResetFailure = 'invalid' | 'expired' | 'used';

export interface ResetOutcome {
  readonly ok: boolean;
  readonly reason: ResetFailure | null;
}

/**
 * Verifica un token senza consumarlo.
 *
 * Serve alla pagina di reimpostazione, che deve poter mostrare "questo link non
 * è più valido" **prima** che l'utente scriva una password nuova — invece di
 * accoglierla e rifiutarla dopo, che è il modo più efficace per fargli credere
 * di aver sbagliato lui.
 */
export async function checkResetToken(token: string): Promise<ResetOutcome> {
  const sql = getSql();
  const tokenHash = await hashToken(token);

  const rows = await sql`
    SELECT used_at, expires_at FROM password_resets WHERE token_hash = ${tokenHash} LIMIT 1`;

  const row = rows[0];
  if (row === undefined) return { ok: false, reason: 'invalid' };
  if (row.used_at !== null && row.used_at !== undefined) return { ok: false, reason: 'used' };
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }
  return { ok: true, reason: null };
}

/** Consuma il token e imposta la nuova password, invalidando ogni sessione aperta. */
export async function consumeReset(token: string, newPassword: string): Promise<ResetOutcome> {
  const sql = getSql();
  const tokenHash = await hashToken(token);

  const rows = await sql`
    SELECT id, user_id, used_at, expires_at
    FROM password_resets
    WHERE token_hash = ${tokenHash}
    LIMIT 1`;

  const row = rows[0];
  if (row === undefined) return { ok: false, reason: 'invalid' };
  if (row.used_at !== null && row.used_at !== undefined) return { ok: false, reason: 'used' };
  if (new Date(String(row.expires_at)).getTime() <= Date.now()) {
    return { ok: false, reason: 'expired' };
  }

  // Il token si marca usato PRIMA del cambio password: se la scrittura seguente
  // fallisce, il peggio che accade è un link bruciato e una richiesta da rifare.
  // L'ordine inverso lascerebbe un token valido su una password già cambiata,
  // cioè un secondo accesso utilizzabile da chi avesse intercettato il link.
  await sql`UPDATE password_resets SET used_at = now() WHERE id = ${String(row.id)}`;
  await changePassword(String(row.user_id), newPassword);

  return { ok: true, reason: null };
}

export const RESET_FAILURE_MESSAGES: Readonly<Record<ResetFailure, string>> = {
  invalid: 'Questo link non è valido. Richiedi una nuova reimpostazione.',
  expired: 'Questo link è scaduto: vale un\'ora. Richiedine uno nuovo.',
  used: 'Questo link è già stato usato. Se non sei stato tu, cambia subito la password.',
};
