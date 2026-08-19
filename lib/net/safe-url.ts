/**
 * Guardia contro le richieste verso l'infrastruttura interna (SSRF).
 *
 * Il problema è concreto: le impostazioni permettono a un'organizzazione di
 * indicare un webhook per le notifiche, e quell'URL viene poi chiamato **dal
 * nostro server**. Un utente che scrive `http://169.254.169.254/latest/meta-data/`
 * non sta configurando Slack: sta chiedendo alla nostra infrastruttura di
 * leggere le proprie credenziali cloud e di spedirgliele.
 *
 * Le stesse regole valgono **al salvataggio e alla consegna**. Solo al
 * salvataggio non basterebbe: un DNS che risolve a un indirizzo pubblico durante
 * la validazione e a `127.0.0.1` al momento della chiamata è una tecnica nota,
 * e il controllo va rifatto quando la richiesta parte davvero.
 */

export interface UrlCheck {
  readonly ok: boolean;
  readonly reason: string | null;
}

const ALLOWED_PROTOCOLS = ['https:'];

/**
 * Intervalli riservati IPv4 e IPv6, in forma testuale.
 *
 * Il controllo è su forma letterale dell'host: non risolve il DNS, perché su
 * Edge non c'è un resolver e perché una risoluzione qui sarebbe comunque
 * soggetta al cambio fra controllo e uso. La difesa vera contro il rebinding è
 * l'elenco di host ammessi per i servizi a dominio noto, più in basso.
 */
const BLOCKED_HOST_PATTERNS: readonly RegExp[] = [
  /^localhost$/i,
  /\.local$/i,
  /\.internal$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // metadati delle istanze cloud
  /^0\./,
  /^\[?::1\]?$/,
  /^\[?fc00:/i,
  /^\[?fd[0-9a-f]{2}:/i,
  /^\[?fe80:/i,
];

/** Host ammessi per i servizi a dominio noto. */
export const WEBHOOK_HOST_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  slack: ['hooks.slack.com'],
  teams: ['office.com', 'outlook.office.com', 'webhook.office.com', 'logic.azure.com'],
};

/**
 * Confronto per sottodominio esatto.
 *
 * `endsWith('.slack.com')` lascerebbe passare `hooks.slack.com.evil.test`, che è
 * esattamente il bypass che questo controllo esiste per fermare.
 */
function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function checkWebhookUrl(
  raw: string,
  allowedHosts?: readonly string[],
): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: 'URL non valido.' };
  }

  if (!ALLOWED_PROTOCOLS.includes(url.protocol)) {
    return { ok: false, reason: 'Sono ammessi solo indirizzi https.' };
  }

  const host = url.hostname.toLowerCase();

  if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
    return {
      ok: false,
      reason: 'L\'indirizzo punta a una rete interna o a un servizio di metadati.',
    };
  }

  // Un host senza punto non è un dominio pubblico: è un nome di rete locale.
  if (!host.includes('.')) {
    return { ok: false, reason: 'L\'indirizzo non è un dominio pubblico.' };
  }

  if (url.port !== '' && url.port !== '443') {
    return { ok: false, reason: 'Sono ammesse solo connessioni sulla porta 443.' };
  }

  if (allowedHosts !== undefined && allowedHosts.length > 0) {
    const allowed = allowedHosts.some((entry) => hostMatches(host, entry));
    if (!allowed) {
      return {
        ok: false,
        reason: `Per questo servizio sono ammessi solo: ${allowedHosts.join(', ')}.`,
      };
    }
  }

  return { ok: true, reason: null };
}

export function isSlackWebhook(raw: string): UrlCheck {
  return checkWebhookUrl(raw, WEBHOOK_HOST_ALLOWLIST.slack);
}

export function isTeamsWebhook(raw: string): UrlCheck {
  return checkWebhookUrl(raw, WEBHOOK_HOST_ALLOWLIST.teams);
}
