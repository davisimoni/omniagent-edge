import { z } from 'zod';
import { getCurrentAccount } from '@/lib/auth/current-user';
import { hasFeature } from '@/lib/billing/plans';
import { saveNotificationSettings } from '@/lib/notifications/dispatch';
import { isSlackWebhook, isTeamsWebhook } from '@/lib/net/safe-url';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const settingsSchema = z.object({
  slackWebhookUrl: z.string().trim().max(500).nullable(),
  teamsWebhookUrl: z.string().trim().max(500).nullable(),
  emailRecipients: z.array(z.string().trim().email()).max(20),
  notifyFromBand: z.enum(['low', 'medium', 'high', 'critical']),
});

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Configurazione delle notifiche.
 *
 * Gli URL passano dalla guardia SSRF **al salvataggio**, e ci ripassano alla
 * consegna. Solo qui non basterebbe: fra la configurazione e il primo avviso
 * può passare un mese, e un dominio che nel frattempo risolve a un indirizzo
 * interno è esattamente lo scenario da cui la guardia difende.
 */
export async function PATCH(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return json(401, { error: 'unauthenticated', message: 'Sessione non valida.' });
  }

  if (!hasFeature(account.organization.plan, 'teamNotifications')) {
    return json(402, {
      error: 'feature_not_in_plan',
      message: 'Le notifiche al team sono incluse dal piano Pro.',
      requiredPlan: 'pro',
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = settingsSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Controlla i campi inseriti.' });
  }

  const { slackWebhookUrl, teamsWebhookUrl } = parsed.data;

  if (slackWebhookUrl !== null && slackWebhookUrl.length > 0) {
    const check = isSlackWebhook(slackWebhookUrl);
    if (!check.ok) return json(400, { error: 'invalid_slack_url', message: check.reason });
  }

  if (teamsWebhookUrl !== null && teamsWebhookUrl.length > 0) {
    const check = isTeamsWebhook(teamsWebhookUrl);
    if (!check.ok) return json(400, { error: 'invalid_teams_url', message: check.reason });
  }

  try {
    await saveNotificationSettings(account.organization.id, {
      slackWebhookUrl: slackWebhookUrl !== null && slackWebhookUrl.length > 0 ? slackWebhookUrl : null,
      teamsWebhookUrl: teamsWebhookUrl !== null && teamsWebhookUrl.length > 0 ? teamsWebhookUrl : null,
      emailRecipients: parsed.data.emailRecipients,
      notifyFromBand: parsed.data.notifyFromBand,
    });
    return json(200, { ok: true });
  } catch (error) {
    console.error('[settings/notifications] errore', error);
    return json(500, { error: 'save_failed', message: 'Salvataggio non riuscito.' });
  }
}
