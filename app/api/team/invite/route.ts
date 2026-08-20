import { z } from 'zod';
import { getCurrentAccount } from '@/lib/auth/current-user';
import { createInvitation, revokeInvitation } from '@/lib/auth/invitations';
import { readEnv } from '@/lib/env';

export const runtime = 'edge';
export const preferredRegion = ['fra1'];
export const dynamic = 'force-dynamic';

const inviteSchema = z.object({
  email: z.string().trim().email().max(254),
  role: z.enum(['admin', 'member']).default('member'),
});

const revokeSchema = z.object({ invitationId: z.string().min(1).max(64) });

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

/**
 * Invito di un collega nel workspace.
 *
 * **Solo chi amministra può invitare.** Un membro qualsiasi che potesse
 * aggiungere persone deciderebbe chi vede i contratti dell'azienda, e
 * consumerebbe postazioni che qualcun altro paga.
 *
 * Il ruolo `owner` non è assegnabile da qui: si è proprietari perché si è creato
 * il workspace. Permetterlo significherebbe che un amministratore può crearsi un
 * pari grado e rendere irreversibile una decisione che non gli spetta.
 */
export async function POST(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return json(401, { error: 'unauthenticated', message: 'Accedi per invitare qualcuno.' });
  }

  if (account.role === 'member') {
    return json(403, {
      error: 'forbidden',
      message: 'Solo chi amministra il workspace può invitare nuove persone.',
    });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Inserisci un indirizzo email valido.' });
  }

  const origin = readEnv('NEXT_PUBLIC_APP_URL') ?? new URL(request.url).origin;

  try {
    const result = await createInvitation({
      organizationId: account.organization.id,
      organizationName: account.organization.name,
      plan: account.organization.plan,
      email: parsed.data.email,
      role: parsed.data.role,
      invitedBy: account.user.id,
      invitedByName: account.user.name,
      baseUrl: origin,
    });

    if (!result.ok) {
      // Le postazioni esaurite sono una decisione commerciale, non un errore di
      // chi compila il modulo: 402 le distingue e permette all'interfaccia di
      // proporre l'upgrade invece di mostrare un riquadro rosso.
      const status = result.reason === 'seats_exhausted' ? 402 : 409;
      return json(status, { error: result.reason, message: result.message });
    }

    return json(201, {
      ok: true,
      invitation: result.invitation,
      emailDelivered: result.email?.delivered ?? false,
      emailReason: result.email?.reason ?? null,
      // Presente solo quando l'email non è partita: senza, l'invito sarebbe
      // creato e inutilizzabile.
      link: result.link,
    });
  } catch (error) {
    console.error('[team/invite] errore', error);
    return json(500, { error: 'invite_failed', message: 'Invito non riuscito.' });
  }
}

/** Revoca un invito ancora aperto, liberando la postazione che teneva occupata. */
export async function DELETE(request: Request): Promise<Response> {
  const account = await getCurrentAccount();
  if (account === null) {
    return json(401, { error: 'unauthenticated', message: 'Accedi per gestire gli inviti.' });
  }
  if (account.role === 'member') {
    return json(403, { error: 'forbidden', message: 'Serve un ruolo di amministrazione.' });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json(400, { error: 'invalid_json', message: 'Il corpo non è JSON valido.' });
  }

  const parsed = revokeSchema.safeParse(raw);
  if (!parsed.success) {
    return json(400, { error: 'invalid_request', message: 'Invito non indicato.' });
  }

  try {
    await revokeInvitation(account.organization.id, parsed.data.invitationId);
    return json(200, { ok: true });
  } catch (error) {
    console.error('[team/invite] revoca fallita', error);
    return json(500, { error: 'revoke_failed', message: 'Revoca non riuscita.' });
  }
}
