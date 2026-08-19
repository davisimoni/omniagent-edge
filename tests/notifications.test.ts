import { describe, expect, it, vi } from 'vitest';
import { assembleAudit } from '@/lib/audit/engine';
import {
  buildAlert,
  buildEmailBody,
  buildSlackPayload,
  buildTeamsPayload,
  DEFAULT_NOTIFICATION_SETTINGS,
  dispatchAudit,
  shouldNotify,
  type AuditAlert,
} from '@/lib/notifications/dispatch';
import { checkWebhookUrl, isSlackWebhook, isTeamsWebhook } from '@/lib/net/safe-url';
import { auditContext, auditFindings, clauseAssessments, redFlag } from './fixtures/audit';

/**
 * Test degli avvisi al team e della guardia SSRF.
 *
 * Il gruppo sugli URL è quello che conta di più: le impostazioni permettono a un
 * utente di indicare un indirizzo che poi **il nostro server** chiama. Senza
 * guardia, `http://169.254.169.254/` non configura Slack — chiede alla nostra
 * infrastruttura di leggere le proprie credenziali cloud e spedirle altrove.
 */

const CRITICAL_ALERT: AuditAlert = {
  auditId: 'aud_1',
  sourceName: 'Contratto Nordwind',
  vendorName: 'Nordwind Cloud Services GmbH',
  band: 'critical',
  score: 82,
  criticalFindings: [
    { title: 'Nessun termine per la notifica delle violazioni', category: 'GDPR', quote: 'senza indugio' },
  ],
  missingCriticalClauses: ['Accordo sul trattamento dei dati (DPA)'],
  url: 'https://esempio.test/history/aud_1',
};

function okFetch() {
  return vi.fn(async () => new Response('ok', { status: 200 }) as unknown as Response);
}

// ─────────────────────────────────────────────────────────────────────────────
// Guardia SSRF
// ─────────────────────────────────────────────────────────────────────────────

describe('checkWebhookUrl', () => {
  it('accetta un https pubblico', () => {
    expect(checkWebhookUrl('https://hooks.slack.com/services/T/B/X').ok).toBe(true);
  });

  it('rifiuta http in chiaro', () => {
    expect(checkWebhookUrl('http://hooks.slack.com/services/T/B/X').ok).toBe(false);
  });

  it('rifiuta il servizio di metadati delle istanze cloud', () => {
    // È il bersaglio classico: da lì escono le credenziali del ruolo cloud.
    expect(checkWebhookUrl('https://169.254.169.254/latest/meta-data/').ok).toBe(false);
  });

  it('rifiuta indirizzi di rete interna e localhost', () => {
    for (const url of [
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://10.0.0.5/hook',
      'https://192.168.1.10/hook',
      'https://172.16.0.9/hook',
      'https://servizio.internal/hook',
      'https://db.local/hook',
    ]) {
      expect(checkWebhookUrl(url).ok, url).toBe(false);
    }
  });

  it('rifiuta porte diverse da 443', () => {
    expect(checkWebhookUrl('https://esempio.test:8080/hook').ok).toBe(false);
  });

  it('rifiuta un host senza punto: non è un dominio pubblico', () => {
    expect(checkWebhookUrl('https://intranet/hook').ok).toBe(false);
  });

  it('rifiuta un URL non analizzabile', () => {
    expect(checkWebhookUrl('non-un-url').ok).toBe(false);
  });

  it('vincola Slack al proprio host', () => {
    expect(isSlackWebhook('https://hooks.slack.com/services/T/B/X').ok).toBe(true);
    expect(isSlackWebhook('https://esempio.test/finto-slack').ok).toBe(false);
  });

  it('non si fa ingannare da un sottodominio contraffatto', () => {
    // `endsWith('.slack.com')` lascerebbe passare questo: il confronto è per
    // sottodominio esatto proprio per fermarlo.
    expect(isSlackWebhook('https://hooks.slack.com.evil.test/x').ok).toBe(false);
  });

  it('accetta gli host noti di Teams', () => {
    expect(isTeamsWebhook('https://azienda.webhook.office.com/webhookb2/abc').ok).toBe(true);
    expect(isTeamsWebhook('https://evil.test/webhookb2/abc').ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Soglia
// ─────────────────────────────────────────────────────────────────────────────

describe('shouldNotify', () => {
  it('avvisa dalla soglia in su', () => {
    expect(shouldNotify('critical', 'critical')).toBe(true);
    expect(shouldNotify('high', 'critical')).toBe(false);
    expect(shouldNotify('high', 'medium')).toBe(true);
    expect(shouldNotify('low', 'low')).toBe(true);
  });

  it('la soglia predefinita è "solo critici"', () => {
    // Un canale che riceve ogni rilievo viene silenziato entro una settimana, e
    // da quel momento non avvisa più nemmeno dei critici.
    expect(DEFAULT_NOTIFICATION_SETTINGS.notifyFromBand).toBe('critical');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composizione
// ─────────────────────────────────────────────────────────────────────────────

describe('buildAlert', () => {
  it('estrae dall\'audit solo i rilievi critici, e non più di tre', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: Array.from({ length: 6 }, (_, index) =>
          redFlag({ title: `Critico ${index}`, severity: 'critical' }),
        ),
      }),
      auditContext(),
    );

    const alert = buildAlert(audit, 'https://esempio.test', 'aud_9');
    expect(alert.criticalFindings).toHaveLength(3);
    expect(alert.url).toBe('https://esempio.test/history/aud_9');
  });

  it('elenca le clausole critiche assenti', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: [],
        clauseAssessments: clauseAssessments('present', { gdpr_dpa: 'absent' }),
      }),
      auditContext(),
    );

    const alert = buildAlert(audit, null, 'aud_1');
    expect(alert.missingCriticalClauses.length).toBeGreaterThan(0);
    expect(alert.url).toBeNull();
  });

  it('tronca la citazione: un avviso non è il report', () => {
    const audit = assembleAudit(
      auditFindings({
        redFlags: [redFlag({ severity: 'critical', citation: { quote: 'x'.repeat(600), locator: null } })],
      }),
      auditContext(),
    );
    expect(buildAlert(audit, null, 'aud_1').criticalFindings[0]?.quote.length).toBeLessThanOrEqual(180);
  });
});

describe('composizione dei messaggi', () => {
  it('Slack riceve punteggio, documento e link', () => {
    const payload = JSON.stringify(buildSlackPayload(CRITICAL_ALERT));
    expect(payload).toContain('82/100');
    expect(payload).toContain('Contratto Nordwind');
    expect(payload).toContain('history/aud_1');
  });

  it('Teams riceve una MessageCard valida', () => {
    const payload = buildTeamsPayload(CRITICAL_ALERT) as Record<string, unknown>;
    expect(payload['@type']).toBe('MessageCard');
    expect(JSON.stringify(payload)).toContain('Nordwind');
  });

  it('l\'email porta oggetto, rilievi e avvertenza', () => {
    const { subject, text } = buildEmailBody(CRITICAL_ALERT);
    expect(subject).toContain('Contratto Nordwind');
    expect(text).toContain('Nessun termine per la notifica');
    expect(text).toContain('non costituisce consulenza legale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Consegna
// ─────────────────────────────────────────────────────────────────────────────

describe('dispatchAudit', () => {
  it('non invia nulla sotto la soglia configurata', async () => {
    const fetchImpl = okFetch();
    const result = await dispatchAudit(
      { ...CRITICAL_ALERT, band: 'medium' },
      { ...DEFAULT_NOTIFICATION_SETTINGS, slackWebhookUrl: 'https://hooks.slack.com/services/x' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.triggered).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('consegna su Slack quando la soglia è raggiunta', async () => {
    const fetchImpl = okFetch();
    const result = await dispatchAudit(
      CRITICAL_ALERT,
      { ...DEFAULT_NOTIFICATION_SETTINGS, slackWebhookUrl: 'https://hooks.slack.com/services/x' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.triggered).toBe(true);
    expect(result.results).toEqual([{ channel: 'slack', delivered: true, reason: null }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('rivalida l\'URL alla consegna, non solo al salvataggio', async () => {
    // Fra la configurazione e il primo avviso può passare un mese: un dominio
    // che nel frattempo punta a una rete interna va fermato qui.
    const fetchImpl = okFetch();
    const result = await dispatchAudit(
      CRITICAL_ALERT,
      { ...DEFAULT_NOTIFICATION_SETTINGS, slackWebhookUrl: 'https://127.0.0.1/hook' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.results[0]).toMatchObject({ channel: 'slack', delivered: false });
  });

  it('riporta il fallimento di un canale senza lanciare', async () => {
    // Un canale rotto in silenzio è peggio di un canale assente: qualcuno conta
    // su un avviso che non arriverà.
    const fetchImpl = vi.fn(async () => new Response('no', { status: 500 }) as unknown as Response);
    const result = await dispatchAudit(
      CRITICAL_ALERT,
      { ...DEFAULT_NOTIFICATION_SETTINGS, slackWebhookUrl: 'https://hooks.slack.com/services/x' },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.results[0]).toMatchObject({ delivered: false });
    expect(result.results[0]?.reason).toContain('500');
  });

  it('un errore di rete non interrompe gli altri canali', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('slack')) throw new Error('rete non raggiungibile');
      return new Response('ok', { status: 200 }) as unknown as Response;
    });

    const result = await dispatchAudit(
      CRITICAL_ALERT,
      {
        ...DEFAULT_NOTIFICATION_SETTINGS,
        slackWebhookUrl: 'https://hooks.slack.com/services/x',
        teamsWebhookUrl: 'https://azienda.webhook.office.com/webhookb2/x',
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(result.results).toHaveLength(2);
    expect(result.results.find((entry) => entry.channel === 'slack')?.delivered).toBe(false);
    expect(result.results.find((entry) => entry.channel === 'teams')?.delivered).toBe(true);
  });

  it('senza fornitore email dichiara di non aver inviato, invece di fingere', async () => {
    const result = await dispatchAudit(
      CRITICAL_ALERT,
      { ...DEFAULT_NOTIFICATION_SETTINGS, emailRecipients: ['legale@azienda.it'] },
      { fetchImpl: okFetch() as unknown as typeof fetch },
    );

    const email = result.results.find((entry) => entry.channel === 'email');
    expect(email?.delivered).toBe(false);
    expect(email?.reason).toContain('EMAIL_API_URL');
  });

  it('senza canali configurati non produce risultati', async () => {
    const result = await dispatchAudit(CRITICAL_ALERT, DEFAULT_NOTIFICATION_SETTINGS, {
      fetchImpl: okFetch() as unknown as typeof fetch,
    });
    expect(result.triggered).toBe(true);
    expect(result.results).toEqual([]);
  });
});
