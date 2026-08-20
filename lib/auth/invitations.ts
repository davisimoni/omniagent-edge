import { getSql, newId } from '@/lib/db/client';
import { normalizeEmail, type MemberRole } from '@/lib/auth/repository';
import { buildTokenUrl, generateToken, hashToken, INVITE_TTL_MS } from '@/lib/auth/tokens';
import { sendEmail, type EmailResult } from '@/lib/email/send';
import { getPlan, type PlanId } from '@/lib/billing/plans';

/**
 * Inviti al workspace.
 *
 * **Le postazioni si contano includendo gli inviti ancora aperti.** Contare solo
 * i membri effettivi renderebbe il limite aggirabile in modo banale: si generano
 * dieci inviti di fila e li si accetta dopo. Il controllo avviene **prima** di
 * creare l'invito, non al momento dell'accettazione — scoprire che non c'è posto
 * dopo aver ricevuto un invito è una figuraccia verso una persona che non ha
 * fatto nulla di sbagliato.
 */

export type SeatCheckReason = 'seats_exhausted' | 'already_member' | 'already_invited';

export interface SeatUsage {
  readonly members: number;
  readonly pendingInvites: number;
  readonly used: number;
  /** `null` quando il piano non pone un limite. */
  readonly limit: number | null;
  readonly remaining: number | null;
}

/**
 * Occupazione delle postazioni.
 *
 * Funzione pura: i conteggi arrivano dal chiamante, così la regola — inviti
 * aperti inclusi — è verificabile senza database.
 */
export function computeSeatUsage(
  plan: PlanId,
  members: number,
  pendingInvites: number,
): SeatUsage {
  const limit = getPlan(plan).seats;
  const used = members + pendingInvites;
  return {
    members,
    pendingInvites,
    used,
    limit,
    remaining: limit === null ? null : Math.max(0, limit - used),
  };
}

export interface InvitationRecord {
  readonly id: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly invitedByName: string | null;
  readonly expiresAt: string;
  readonly createdAt: string;
}

export interface InviteResult {
  readonly ok: boolean;
  readonly reason: SeatCheckReason | null;
  readonly message: string | null;
  readonly invitation: InvitationRecord | null;
  readonly email: EmailResult | null;
  /** Link diretto: mostrato quando non c'è fornitore di posta, per non bloccare il flusso. */
  readonly link: string | null;
}

export async function countSeats(organizationId: string, plan: PlanId): Promise<SeatUsage> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      (SELECT COUNT(*) FROM memberships WHERE organization_id = ${organizationId})::int AS members,
      (SELECT COUNT(*) FROM invitations
        WHERE organization_id = ${organizationId}
          AND accepted_at IS NULL
          AND expires_at > now())::int AS pending`;

  return computeSeatUsage(plan, Number(rows[0]?.members ?? 0), Number(rows[0]?.pending ?? 0));
}

export async function listInvitations(organizationId: string): Promise<InvitationRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT i.*, u.name AS invited_by_name
    FROM invitations i
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.organization_id = ${organizationId}
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
    ORDER BY i.created_at DESC`;

  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    role: String(row.role) as MemberRole,
    invitedByName: row.invited_by_name === null ? null : String(row.invited_by_name ?? ''),
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
  }));
}

function buildInviteEmail(
  workspaceName: string,
  inviterName: string,
  link: string,
): { subject: string; text: string } {
  return {
    subject: `${inviterName} ti invita nel workspace ${workspaceName}`,
    text: [
      `${inviterName} ti ha invitato a collaborare nel workspace "${workspaceName}" su OmniAgent Edge.`,
      '',
      'OmniAgent Edge analizza i contratti fornitori e segnala penali, termini di recesso,',
      'lacune GDPR e ISO 27001 e scostamenti di SLA, ognuno con la citazione del passaggio',
      'che lo genera.',
      '',
      'Accetta l\'invito qui:',
      link,
      '',
      'Il link scade fra sette giorni.',
    ].join('\n'),
  };
}

export interface CreateInvitationInput {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly plan: PlanId;
  readonly email: string;
  readonly role: MemberRole;
  readonly invitedBy: string;
  readonly invitedByName: string;
  readonly baseUrl: string;
}

export async function createInvitation(
  input: CreateInvitationInput,
  fetchImpl: typeof fetch = fetch,
): Promise<InviteResult> {
  const sql = getSql();
  const email = normalizeEmail(input.email);

  // 1. La persona è già dentro? Un secondo invito non aggiungerebbe nulla e
  //    consumerebbe una postazione che è già occupata dalla stessa persona.
  const existingMember = await sql`
    SELECT 1 FROM memberships m
    JOIN users u ON u.id = m.user_id
    WHERE m.organization_id = ${input.organizationId} AND u.email = ${email}
    LIMIT 1`;
  if (existingMember.length > 0) {
    return {
      ok: false,
      reason: 'already_member',
      message: 'Questa persona fa già parte del workspace.',
      invitation: null,
      email: null,
      link: null,
    };
  }

  const existingInvite = await sql`
    SELECT 1 FROM invitations
    WHERE organization_id = ${input.organizationId}
      AND email = ${email}
      AND accepted_at IS NULL
      AND expires_at > now()
    LIMIT 1`;
  if (existingInvite.length > 0) {
    return {
      ok: false,
      reason: 'already_invited',
      message: 'Un invito per questo indirizzo è già aperto.',
      invitation: null,
      email: null,
      link: null,
    };
  }

  // 2. Postazioni, inviti aperti inclusi.
  const seats = await countSeats(input.organizationId, input.plan);
  if (seats.remaining !== null && seats.remaining <= 0) {
    const plan = getPlan(input.plan);
    return {
      ok: false,
      reason: 'seats_exhausted',
      message:
        `Il piano ${plan.name} include ${plan.seats} ${plan.seats === 1 ? 'postazione' : 'postazioni'}, ` +
        `e sono già occupate (${seats.members} ${seats.members === 1 ? 'membro' : 'membri'}` +
        `${seats.pendingInvites > 0 ? ` e ${seats.pendingInvites} inviti aperti` : ''}). ` +
        'Passa a un piano superiore o revoca un invito.',
      invitation: null,
      email: null,
      link: null,
    };
  }

  const token = generateToken();
  const tokenHash = await hashToken(token);
  const id = newId('inv');
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();

  await sql`
    INSERT INTO invitations (id, organization_id, email, role, token_hash, invited_by, expires_at)
    VALUES (${id}, ${input.organizationId}, ${email}, ${input.role}, ${tokenHash}, ${input.invitedBy}, ${expiresAt})`;

  const link = buildTokenUrl(input.baseUrl, '/invite', token);
  const { subject, text } = buildInviteEmail(input.organizationName, input.invitedByName, link);
  const emailResult = await sendEmail({ to: [email], subject, text }, fetchImpl);

  return {
    ok: true,
    reason: null,
    message: null,
    invitation: {
      id,
      email,
      role: input.role,
      invitedByName: input.invitedByName,
      expiresAt,
      createdAt: new Date().toISOString(),
    },
    email: emailResult,
    // Il link torna al chiamante solo quando l'email non è partita: senza
    // fornitore di posta l'invito sarebbe altrimenti inutilizzabile.
    link: emailResult.delivered ? null : link,
  };
}

export async function revokeInvitation(organizationId: string, invitationId: string): Promise<void> {
  const sql = getSql();
  // Filtro per organizzazione nella query, non in un controllo successivo:
  // altrimenti un id indovinato revocherebbe l'invito di un altro workspace.
  await sql`
    DELETE FROM invitations WHERE id = ${invitationId} AND organization_id = ${organizationId}`;
}

export interface InvitePreview {
  readonly organizationId: string;
  readonly organizationName: string;
  readonly email: string;
  readonly role: MemberRole;
  readonly invitedByName: string | null;
}

/** Legge un invito dal token, senza consumarlo: serve alla pagina di accettazione. */
export async function previewInvitation(token: string): Promise<InvitePreview | null> {
  const sql = getSql();
  const tokenHash = await hashToken(token);

  const rows = await sql`
    SELECT i.*, o.name AS organization_name, u.name AS invited_by_name
    FROM invitations i
    JOIN organizations o ON o.id = i.organization_id
    LEFT JOIN users u ON u.id = i.invited_by
    WHERE i.token_hash = ${tokenHash}
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
    LIMIT 1`;

  const row = rows[0];
  if (row === undefined) return null;

  return {
    organizationId: String(row.organization_id),
    organizationName: String(row.organization_name),
    email: String(row.email),
    role: String(row.role) as MemberRole,
    invitedByName: row.invited_by_name === null ? null : String(row.invited_by_name ?? ''),
  };
}

export type AcceptFailure = 'invalid' | 'seats_exhausted' | 'already_member';

export interface AcceptResult {
  readonly ok: boolean;
  readonly reason: AcceptFailure | null;
  readonly organizationId: string | null;
}

/**
 * Accetta un invito per un utente già registrato.
 *
 * Le postazioni si ricontrollano **anche qui**: fra l'invio dell'invito e la sua
 * accettazione può passare una settimana, e in quella settimana il workspace può
 * essere passato a un piano inferiore o aver riempito i posti con altri inviti.
 */
export async function acceptInvitation(token: string, userId: string): Promise<AcceptResult> {
  const sql = getSql();
  const tokenHash = await hashToken(token);

  const rows = await sql`
    SELECT i.*, o.plan
    FROM invitations i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.token_hash = ${tokenHash}
      AND i.accepted_at IS NULL
      AND i.expires_at > now()
    LIMIT 1`;

  const row = rows[0];
  if (row === undefined) return { ok: false, reason: 'invalid', organizationId: null };

  const organizationId = String(row.organization_id);

  const existing = await sql`
    SELECT 1 FROM memberships
    WHERE organization_id = ${organizationId} AND user_id = ${userId}
    LIMIT 1`;
  if (existing.length > 0) {
    await sql`UPDATE invitations SET accepted_at = now() WHERE id = ${String(row.id)}`;
    return { ok: true, reason: null, organizationId };
  }

  const seats = await countSeats(organizationId, String(row.plan) as PlanId);
  // L'invito che si sta accettando è già contato fra quelli aperti: il posto
  // che occuperà è quindi già riservato, e va escluso dal confronto.
  const availableAfterThis = seats.remaining === null ? null : seats.remaining + 1;
  if (availableAfterThis !== null && availableAfterThis <= 0) {
    return { ok: false, reason: 'seats_exhausted', organizationId };
  }

  await sql`
    INSERT INTO memberships (user_id, organization_id, role)
    VALUES (${userId}, ${organizationId}, ${String(row.role)})`;
  await sql`UPDATE invitations SET accepted_at = now() WHERE id = ${String(row.id)}`;

  return { ok: true, reason: null, organizationId };
}
