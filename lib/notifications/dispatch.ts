import { getSql } from '@/lib/db/client';
import { BAND_LABELS } from '@/lib/audit/report';
import { CATEGORY_LABELS, SEVERITY_LABELS, type ContractAudit, type RiskBand } from '@/lib/audit/schema';
import { isSlackWebhook, isTeamsWebhook } from '@/lib/net/safe-url';
import { readEnv } from '@/lib/env';

/**
 * Notifiche al team legale.
 *
 * **Nessuna notifica fa fallire un audit.** Un canale Slack rimosso, un webhook
 * scaduto o Teams irraggiungibile non devono trasformarsi in un audit perso: il
 * documento è già stato analizzato e il credito già consumato. `dispatchAudit`
 * non lancia mai e restituisce l'esito di ogni canale, che le impostazioni
 * mostrano — un canale rotto in silenzio è peggio di un canale assente, perché
 * qualcuno conta su un avviso che non arriverà.
 *
 * **La soglia predefinita è "solo critici".** Un canale che riceve ogni rilievo
 * viene silenziato entro una settimana, e da quel momento non avvisa più nemmeno
 * dei critici — che è l'unica cosa per cui era stato creato.
 */

const BAND_RANK: Readonly<Record<RiskBand, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

export interface NotificationSettings {
  readonly slackWebhookUrl: string | null;
  readonly teamsWebhookUrl: string | null;
  readonly emailRecipients: readonly string[];
  readonly notifyFromBand: RiskBand;
}

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  slackWebhookUrl: null,
  teamsWebhookUrl: null,
  emailRecipients: [],
  notifyFromBand: 'critical',
};

export type ChannelName = 'slack' | 'teams' | 'email';

export interface ChannelResult {
  readonly channel: ChannelName;
  readonly delivered: boolean;
  readonly reason: string | null;
}

export interface DispatchResult {
  readonly triggered: boolean;
  readonly band: RiskBand;
  readonly results: readonly ChannelResult[];
}

/** True se la fascia raggiunge la soglia configurata. */
export function shouldNotify(band: RiskBand, threshold: RiskBand): boolean {
  return BAND_RANK[band] >= BAND_RANK[threshold];
}

export async function getNotificationSettings(
  organizationId: string,
): Promise<NotificationSettings> {
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM notification_settings WHERE organization_id = ${organizationId} LIMIT 1`;

  const row = rows[0];
  if (row === undefined) return DEFAULT_NOTIFICATION_SETTINGS;

  return {
    slackWebhookUrl: row.slack_webhook_url === null ? null : String(row.slack_webhook_url ?? ''),
    teamsWebhookUrl: row.teams_webhook_url === null ? null : String(row.teams_webhook_url ?? ''),
    emailRecipients: Array.isArray(row.email_recipients)
      ? (row.email_recipients as string[])
      : [],
    notifyFromBand: String(row.notify_from_band ?? 'critical') as RiskBand,
  };
}

export async function saveNotificationSettings(
  organizationId: string,
  settings: NotificationSettings,
): Promise<void> {
  const sql = getSql();
  // L'array va passato come array JavaScript: il driver lo serializza nel
  // letterale Postgres per la colonna `text[]`. L'asserzione serve solo al
  // sistema dei tipi del template literal, che dichiara parametri primitivi —
  // non trasforma il valore, che deve restare un array anche a runtime.
  const recipients = [...settings.emailRecipients] as unknown as string;
  await sql`
    INSERT INTO notification_settings (
      organization_id, slack_webhook_url, teams_webhook_url, email_recipients, notify_from_band, updated_at
    ) VALUES (
      ${organizationId},
      ${settings.slackWebhookUrl},
      ${settings.teamsWebhookUrl},
      ${recipients},
      ${settings.notifyFromBand},
      now()
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      slack_webhook_url = EXCLUDED.slack_webhook_url,
      teams_webhook_url = EXCLUDED.teams_webhook_url,
      email_recipients = EXCLUDED.email_recipients,
      notify_from_band = EXCLUDED.notify_from_band,
      updated_at = now()`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Composizione del messaggio
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditAlert {
  readonly auditId: string;
  readonly sourceName: string;
  readonly vendorName: string | null;
  readonly band: RiskBand;
  readonly score: number;
  readonly criticalFindings: readonly { title: string; category: string; quote: string }[];
  readonly missingCriticalClauses: readonly string[];
  readonly url: string | null;
}

/** Estrae dall'audit il minimo indispensabile per un avviso leggibile. */
export function buildAlert(audit: ContractAudit, baseUrl: string | null, recordId: string): AuditAlert {
  const critical = audit.redFlags
    .filter((flag) => flag.severity === 'critical')
    .slice(0, 3)
    .map((flag) => ({
      title: flag.title,
      category: CATEGORY_LABELS[flag.category],
      // Troncata: un avviso non è il report, serve a far aprire il report.
      quote: flag.citation.quote.slice(0, 180),
    }));

  return {
    auditId: recordId,
    sourceName: audit.sourceName,
    vendorName: audit.findings.parties[0]?.name ?? null,
    band: audit.riskScore.band,
    score: audit.riskScore.overall,
    criticalFindings: critical,
    missingCriticalClauses: audit.missingClauses
      .filter((clause) => clause.severity === 'critical')
      .map((clause) => clause.name)
      .slice(0, 5),
    url: baseUrl === null ? null : `${baseUrl}/history/${recordId}`,
  };
}

export function buildSlackPayload(alert: AuditAlert): unknown {
  const lines = [
    `*Rischio ${BAND_LABELS[alert.band].toUpperCase()} — ${alert.score}/100*`,
    `Documento: ${alert.sourceName}`,
    alert.vendorName !== null ? `Fornitore: ${alert.vendorName}` : null,
  ].filter((line): line is string => line !== null);

  if (alert.criticalFindings.length > 0) {
    lines.push('', '*Rilievi critici:*');
    for (const finding of alert.criticalFindings) {
      lines.push(`• ${finding.title} _(${finding.category})_`);
    }
  }

  if (alert.missingCriticalClauses.length > 0) {
    lines.push('', `*Clausole critiche assenti:* ${alert.missingCriticalClauses.join(', ')}`);
  }

  if (alert.url !== null) lines.push('', `<${alert.url}|Apri il report completo>`);

  return {
    text: `Audit critico: ${alert.sourceName} (${alert.score}/100)`,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: lines.join('\n') },
      },
    ],
  };
}

export function buildTeamsPayload(alert: AuditAlert): unknown {
  const facts = [
    { name: 'Punteggio', value: `${alert.score}/100 — ${BAND_LABELS[alert.band]}` },
    { name: 'Documento', value: alert.sourceName },
  ];
  if (alert.vendorName !== null) facts.push({ name: 'Fornitore', value: alert.vendorName });
  if (alert.missingCriticalClauses.length > 0) {
    facts.push({ name: 'Clausole critiche assenti', value: alert.missingCriticalClauses.join(', ') });
  }

  return {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: `Audit critico: ${alert.sourceName}`,
    themeColor: alert.band === 'critical' ? 'C0392B' : 'E67E22',
    title: `Rischio ${BAND_LABELS[alert.band].toLowerCase()} rilevato`,
    sections: [
      {
        facts,
        text: alert.criticalFindings.map((finding) => `- ${finding.title}`).join('\n'),
      },
    ],
    potentialAction:
      alert.url === null
        ? []
        : [
            {
              '@type': 'OpenUri',
              name: 'Apri il report',
              targets: [{ os: 'default', uri: alert.url }],
            },
          ],
  };
}

/** Corpo testuale dell'email, per il seam di invio. */
export function buildEmailBody(alert: AuditAlert): { subject: string; text: string } {
  const lines = [
    `Rischio ${BAND_LABELS[alert.band].toLowerCase()} — ${alert.score}/100`,
    '',
    `Documento: ${alert.sourceName}`,
    alert.vendorName !== null ? `Fornitore: ${alert.vendorName}` : '',
    '',
  ];

  if (alert.criticalFindings.length > 0) {
    lines.push('Rilievi critici:');
    for (const finding of alert.criticalFindings) {
      lines.push(`- ${finding.title} (${finding.category})`);
      lines.push(`  «${finding.quote}»`);
    }
    lines.push('');
  }

  if (alert.missingCriticalClauses.length > 0) {
    lines.push(`Clausole critiche assenti: ${alert.missingCriticalClauses.join(', ')}`);
    lines.push('');
  }

  if (alert.url !== null) lines.push(`Report completo: ${alert.url}`);
  lines.push('', 'Analisi automatica: non costituisce consulenza legale.');

  return {
    subject: `[OmniAgent] Rischio ${BAND_LABELS[alert.band].toLowerCase()} — ${alert.sourceName}`,
    text: lines.filter((line) => line !== undefined).join('\n'),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Consegna
// ─────────────────────────────────────────────────────────────────────────────

export interface DispatchDependencies {
  readonly fetchImpl: typeof fetch;
  readonly timeoutMs: number;
}

const defaultDeps: DispatchDependencies = { fetchImpl: fetch, timeoutMs: 5_000 };

async function postJson(
  url: string,
  body: unknown,
  deps: DispatchDependencies,
): Promise<ChannelResult['reason']> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return response.ok ? null : `Il servizio ha risposto ${response.status}.`;
  } catch (error) {
    return error instanceof Error ? error.message : 'Errore di rete.';
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Invia l'avviso sui canali configurati.
 *
 * L'URL viene rivalidato qui, non solo al salvataggio: fra la configurazione e
 * la consegna può passare un mese, e un DNS che nel frattempo punta altrove è
 * proprio lo scenario da cui la guardia difende.
 */
export async function dispatchAudit(
  alert: AuditAlert,
  settings: NotificationSettings,
  overrides: Partial<DispatchDependencies> = {},
): Promise<DispatchResult> {
  const deps: DispatchDependencies = { ...defaultDeps, ...overrides };

  if (!shouldNotify(alert.band, settings.notifyFromBand)) {
    return { triggered: false, band: alert.band, results: [] };
  }

  const results: ChannelResult[] = [];

  if (settings.slackWebhookUrl !== null && settings.slackWebhookUrl.length > 0) {
    const check = isSlackWebhook(settings.slackWebhookUrl);
    if (!check.ok) {
      results.push({ channel: 'slack', delivered: false, reason: check.reason });
    } else {
      const reason = await postJson(settings.slackWebhookUrl, buildSlackPayload(alert), deps);
      results.push({ channel: 'slack', delivered: reason === null, reason });
    }
  }

  if (settings.teamsWebhookUrl !== null && settings.teamsWebhookUrl.length > 0) {
    const check = isTeamsWebhook(settings.teamsWebhookUrl);
    if (!check.ok) {
      results.push({ channel: 'teams', delivered: false, reason: check.reason });
    } else {
      const reason = await postJson(settings.teamsWebhookUrl, buildTeamsPayload(alert), deps);
      results.push({ channel: 'teams', delivered: reason === null, reason });
    }
  }

  if (settings.emailRecipients.length > 0) {
    results.push(await sendEmail(alert, settings.emailRecipients, deps));
  }

  return { triggered: true, band: alert.band, results };
}

/**
 * Invio email attraverso un seam agnostico rispetto al fornitore.
 *
 * Accetta qualunque endpoint che riceva `{to, subject, text}` in POST — Resend,
 * Postmark, un relay interno. Senza `EMAIL_API_URL` dichiara di non essere
 * configurato invece di fingere l'invio: un canale che riporta "consegnato"
 * senza aver spedito nulla è il difetto peggiore che un sistema di avvisi possa
 * avere, perché nessuno va a verificarlo.
 */
async function sendEmail(
  alert: AuditAlert,
  recipients: readonly string[],
  deps: DispatchDependencies,
): Promise<ChannelResult> {
  const endpoint = readEnv('EMAIL_API_URL');
  if (endpoint === undefined) {
    return {
      channel: 'email',
      delivered: false,
      reason: 'EMAIL_API_URL non configurata: nessuna email è stata inviata.',
    };
  }

  const apiKey = readEnv('EMAIL_API_KEY');
  const { subject, text } = buildEmailBody(alert);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
  try {
    const response = await deps.fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(apiKey !== undefined ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        from: readEnv('EMAIL_FROM') ?? 'omniagent@example.invalid',
        to: [...recipients],
        subject,
        text,
      }),
      signal: controller.signal,
    });
    return {
      channel: 'email',
      delivered: response.ok,
      reason: response.ok ? null : `Il servizio email ha risposto ${response.status}.`,
    };
  } catch (error) {
    return {
      channel: 'email',
      delivered: false,
      reason: error instanceof Error ? error.message : 'Errore di rete.',
    };
  } finally {
    clearTimeout(timer);
  }
}

export { SEVERITY_LABELS };
