import { readEnv, isProduction } from '@/lib/env';

/**
 * Invio email attraverso un seam agnostico rispetto al fornitore.
 *
 * Accetta qualunque endpoint che riceva `{ from, to[], subject, text }` in POST:
 * Resend, Postmark, un relay interno. Un solo punto di uscita per tutte le
 * email dell'applicazione — inviti, reimpostazione password, avvisi di audit —
 * perché tre implementazioni separate divergono su timeout, gestione degli
 * errori e mittente, e la terza dimentica sempre qualcosa.
 *
 * **Il ripiego in sviluppo non finge di aver inviato.** Senza `EMAIL_API_URL`
 * la funzione restituisce `delivered: false` insieme al **contenuto del
 * messaggio**, che l'interfaccia mostra a schermo. Serve a poter completare un
 * flusso di reimpostazione password in locale senza montare un fornitore di
 * posta; e serve che sia impossibile scambiarlo per un invio riuscito, perché un
 * canale che riporta "consegnato" senza aver spedito nulla è il difetto peggiore
 * che un sistema di notifiche possa avere.
 *
 * In produzione quel ripiego è **disattivato**: restituire il link di
 * reimpostazione nella risposta HTTP significherebbe consegnarlo a chiunque
 * conosca l'indirizzo email di un utente.
 */

export interface EmailMessage {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}

export interface EmailResult {
  readonly delivered: boolean;
  readonly reason: string | null;
  /**
   * Contenuto restituito al chiamante quando non esiste un fornitore configurato
   * e non siamo in produzione. `null` in ogni altro caso.
   */
  readonly devPreview: { subject: string; text: string } | null;
}

export const EMAIL_TIMEOUT_MS = 8_000;

export function isEmailConfigured(): boolean {
  return readEnv('EMAIL_API_URL') !== undefined;
}

/** Mittente configurato; un valore non instradabile se manca, mai un dominio reale altrui. */
export function emailFrom(): string {
  return readEnv('EMAIL_FROM') ?? 'omniagent@example.invalid';
}

export async function sendEmail(
  message: EmailMessage,
  fetchImpl: typeof fetch = fetch,
): Promise<EmailResult> {
  const endpoint = readEnv('EMAIL_API_URL');

  if (endpoint === undefined) {
    return {
      delivered: false,
      reason: 'EMAIL_API_URL non configurata: nessuna email è stata inviata.',
      devPreview: isProduction() ? null : { subject: message.subject, text: message.text },
    };
  }

  const apiKey = readEnv('EMAIL_API_KEY');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EMAIL_TIMEOUT_MS);

  try {
    const response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        from: emailFrom(),
        to: [...message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: controller.signal,
    });

    return {
      delivered: response.ok,
      reason: response.ok ? null : `Il servizio email ha risposto ${response.status}.`,
      devPreview: null,
    };
  } catch (error) {
    return {
      delivered: false,
      reason: error instanceof Error ? error.message : 'Errore di rete.',
      devPreview: null,
    };
  } finally {
    clearTimeout(timer);
  }
}
