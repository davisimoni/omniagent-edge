import { getSql, newId, slugify } from '@/lib/db/client';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import type { PlanId } from '@/lib/billing/plans';

/**
 * Accesso ai dati di account e workspace.
 *
 * Ogni funzione che tocca dati di tenant riceve `organizationId` e lo mette
 * nella clausola `WHERE`. L'isolamento vive qui, in un solo file: sparpagliarlo
 * nelle rotte significa che alla decima qualcuno lo dimentica, e un audit di
 * un'altra azienda compare in una cronologia che non è la sua.
 */

export type MemberRole = 'owner' | 'admin' | 'member';

export interface UserRecord {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly sessionVersion: number;
  readonly createdAt: string;
  readonly lastLoginAt: string | null;
}

export interface OrganizationRecord {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly plan: PlanId;
  readonly planStatus: string;
  readonly stripeCustomerId: string | null;
  readonly stripeSubscriptionId: string | null;
  readonly currentPeriodEnd: string | null;
}

export interface MemberRecord extends UserRecord {
  readonly role: MemberRole;
}

export class EmailAlreadyRegisteredError extends Error {
  readonly code = 'email_already_registered';
  constructor() {
    super('Esiste già un account con questa email.');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

/**
 * Normalizza l'email.
 *
 * Applicata **prima di ogni scrittura e di ogni lettura**, senza eccezioni:
 * l'unicità la garantisce un vincolo sulla colonna, che confronta byte. Senza
 * normalizzazione, `Mario@Acme.it` e `mario@acme.it` diventerebbero due account
 * distinti e chi ha registrato il primo non riuscirebbe più a entrare.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toUser(row: Record<string, unknown>): UserRecord {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    sessionVersion: Number(row.session_version ?? 1),
    createdAt: String(row.created_at),
    lastLoginAt: row.last_login_at === null || row.last_login_at === undefined
      ? null
      : String(row.last_login_at),
  };
}

function toOrganization(row: Record<string, unknown>): OrganizationRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    plan: String(row.plan) as PlanId,
    planStatus: String(row.plan_status),
    stripeCustomerId: row.stripe_customer_id === null ? null : String(row.stripe_customer_id ?? ''),
    stripeSubscriptionId:
      row.stripe_subscription_id === null ? null : String(row.stripe_subscription_id ?? ''),
    currentPeriodEnd:
      row.current_period_end === null || row.current_period_end === undefined
        ? null
        : String(row.current_period_end),
  };
}

export interface CreateAccountInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
  readonly workspaceName: string;
}

export interface CreateAccountResult {
  readonly user: UserRecord;
  readonly organization: OrganizationRecord;
}

/**
 * Registra un account e il suo workspace.
 *
 * Utente, organizzazione e appartenenza nascono insieme: un utente senza
 * workspace non può fare nulla nell'applicazione, e lasciare che esista in
 * quello stato significa avere uno stato intermedio che ogni schermata deve
 * poi gestire. Lo slug è reso univoco con un suffisso invece di fallire: due
 * aziende che si chiamano "Delta" sono normali, e non è un errore dell'utente.
 */
export async function createAccount(input: CreateAccountInput): Promise<CreateAccountResult> {
  const sql = getSql();
  const email = normalizeEmail(input.email);

  const existing = await sql`SELECT id FROM users WHERE email = ${email} LIMIT 1`;
  if (existing.length > 0) throw new EmailAlreadyRegisteredError();

  const passwordHash = await hashPassword(input.password);
  const userId = newId('usr');
  const orgId = newId('org');
  const slug = `${slugify(input.workspaceName)}-${orgId.slice(-6)}`;

  const [orgRow] = await sql`
    INSERT INTO organizations (id, name, slug, plan)
    VALUES (${orgId}, ${input.workspaceName.trim()}, ${slug}, 'free')
    RETURNING *`;

  const [userRow] = await sql`
    INSERT INTO users (id, email, password_hash, name)
    VALUES (${userId}, ${email}, ${passwordHash}, ${input.name.trim()})
    RETURNING *`;

  await sql`
    INSERT INTO memberships (user_id, organization_id, role)
    VALUES (${userId}, ${orgId}, 'owner')`;

  if (userRow === undefined || orgRow === undefined) {
    throw new Error('Creazione account non riuscita: il database non ha restituito i record.');
  }

  return { user: toUser(userRow), organization: toOrganization(orgRow) };
}

export interface AuthenticatedAccount {
  readonly user: UserRecord;
  readonly organization: OrganizationRecord;
  readonly role: MemberRole;
}

/**
 * Verifica le credenziali.
 *
 * Restituisce `null` sia per email inesistente sia per password errata. La
 * distinzione — "questa email non è registrata" — è comoda per l'utente e
 * altrettanto comoda per chi vuole sapere quali indirizzi hanno un account su
 * questa piattaforma, che in un prodotto B2B dice chi sono i clienti.
 */
export async function authenticate(
  email: string,
  password: string,
): Promise<AuthenticatedAccount | null> {
  const sql = getSql();
  const normalized = normalizeEmail(email);

  const rows = await sql`
    SELECT u.*, m.organization_id, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE u.email = ${normalized}
    ORDER BY m.created_at ASC
    LIMIT 1`;

  const row = rows[0];
  if (row === undefined) {
    // Si esegue comunque una derivazione fittizia: senza, un'email inesistente
    // risponderebbe in millisecondi e una esistente in centinaia, e la
    // differenza rivelerebbe quali account esistono.
    await verifyPassword(password, 'pbkdf2$600000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    return null;
  }

  const valid = await verifyPassword(password, String(row.password_hash));
  if (!valid) return null;

  const organization = await getOrganization(String(row.organization_id));
  if (organization === null) return null;

  await sql`UPDATE users SET last_login_at = now() WHERE id = ${String(row.id)}`;

  return { user: toUser(row), organization, role: String(row.role) as MemberRole };
}

export async function getOrganization(id: string): Promise<OrganizationRecord | null> {
  const sql = getSql();
  const rows = await sql`SELECT * FROM organizations WHERE id = ${id} LIMIT 1`;
  return rows[0] === undefined ? null : toOrganization(rows[0]);
}

/**
 * Carica l'account a partire da una sessione.
 *
 * Il controllo su `sessionVersion` è ciò che rende revocabile un token altrimenti
 * senza stato: un cambio password incrementa il contatore e ogni token emesso
 * prima smette di valere, senza tabella di sessioni da mantenere.
 */
export async function loadAccount(
  userId: string,
  organizationId: string,
  sessionVersion: number,
): Promise<AuthenticatedAccount | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT u.*, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id AND m.organization_id = ${organizationId}
    WHERE u.id = ${userId}
    LIMIT 1`;

  const row = rows[0];
  if (row === undefined) return null;
  if (Number(row.session_version ?? 1) !== sessionVersion) return null;

  const organization = await getOrganization(organizationId);
  if (organization === null) return null;

  return { user: toUser(row), organization, role: String(row.role) as MemberRole };
}

export async function listMembers(organizationId: string): Promise<MemberRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT u.*, m.role
    FROM users u
    JOIN memberships m ON m.user_id = u.id
    WHERE m.organization_id = ${organizationId}
    ORDER BY m.created_at ASC`;
  return rows.map((row) => ({ ...toUser(row), role: String(row.role) as MemberRole }));
}

export async function updateProfile(userId: string, name: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE users SET name = ${name.trim()} WHERE id = ${userId}`;
}

export async function renameOrganization(organizationId: string, name: string): Promise<void> {
  const sql = getSql();
  await sql`UPDATE organizations SET name = ${name.trim()} WHERE id = ${organizationId}`;
}

/** Cambia la password e invalida ogni sessione già emessa. */
export async function changePassword(userId: string, newPassword: string): Promise<void> {
  const sql = getSql();
  const passwordHash = await hashPassword(newPassword);
  await sql`
    UPDATE users
    SET password_hash = ${passwordHash}, session_version = session_version + 1
    WHERE id = ${userId}`;
}
