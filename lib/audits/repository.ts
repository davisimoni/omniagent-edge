import { getSql, newId } from '@/lib/db/client';
import type { ContractAudit, RiskBand } from '@/lib/audit/schema';

/**
 * Archivio degli audit.
 *
 * Le colonne riassuntive — punteggio, fascia, conteggi — sono **duplicate**
 * fuori dal JSONB, e la duplicazione è voluta. L'elenco della cronologia filtra
 * per fascia e ordina per punteggio su potenzialmente migliaia di righe:
 * estrarre quei valori da JSONB a ogni scansione impedirebbe l'uso di un indice
 * e trasformerebbe una pagina di elenco in una scansione completa. Il documento
 * integrale resta la fonte di verità; queste colonne sono una proiezione scritta
 * una volta sola, all'inserimento, insieme al documento da cui derivano.
 */

export type ReviewStatus = 'unassigned' | 'pending' | 'approved' | 'rejected';

export interface AuditSummaryRecord {
  readonly id: string;
  readonly sourceName: string;
  readonly vendorName: string | null;
  readonly contractKey: string;
  readonly riskScore: number;
  readonly riskBand: RiskBand;
  readonly redFlagCount: number;
  readonly criticalCount: number;
  readonly missingClauseCount: number;
  readonly slaViolationCount: number;
  readonly totalTokens: number;
  readonly costUsd: number | null;
  readonly createdAt: string;
  readonly createdByName: string | null;
  readonly assignedTo: string | null;
  readonly assignedToName: string | null;
  readonly reviewStatus: ReviewStatus;
  readonly reviewNotes: string | null;
}

export interface AuditDetailRecord extends AuditSummaryRecord {
  readonly audit: ContractAudit;
}

/**
 * Identità di un contratto attraverso le sue versioni.
 *
 * Normalizza il nome del documento togliendo ciò che cambia fra una revisione e
 * l'altra: numeri di versione, date, suffissi come "def" o "firmato". È
 * un'euristica, non un'identità certa — e per questo il confronto fra versioni
 * mostra sempre i nomi originali, così chi guarda si accorge se il
 * raggruppamento ha unito due documenti diversi.
 */
export function contractKeyFor(sourceName: string): string {
  return sourceName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\.(pdf|docx?|txt|md)$/i, '')
    .replace(/\bv(?:er)?\.?\s?\d+(?:\.\d+)*\b/g, ' ')
    .replace(/\b(?:rev|revisione|versione|bozza|draft|final[e]?|def|firmato|signed)\b/g, ' ')
    .replace(/\b(?:19|20)\d{2}(?:[-/.]\d{1,2}){0,2}\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 120);
}

/** Estrae il nome del fornitore dalle parti individuate, se riconoscibile. */
export function vendorNameFrom(audit: ContractAudit): string | null {
  const supplier = audit.findings.parties.find((party) =>
    /fornitor|supplier|vendor|prestator/i.test(party.role),
  );
  return supplier?.name ?? audit.findings.parties[0]?.name ?? null;
}

function toSummary(row: Record<string, unknown>): AuditSummaryRecord {
  return {
    id: String(row.id),
    sourceName: String(row.source_name),
    vendorName: row.vendor_name === null ? null : String(row.vendor_name ?? ''),
    contractKey: String(row.contract_key),
    riskScore: Number(row.risk_score),
    riskBand: String(row.risk_band) as RiskBand,
    redFlagCount: Number(row.red_flag_count ?? 0),
    criticalCount: Number(row.critical_count ?? 0),
    missingClauseCount: Number(row.missing_clause_count ?? 0),
    slaViolationCount: Number(row.sla_violation_count ?? 0),
    totalTokens: Number(row.total_tokens ?? 0),
    costUsd: row.cost_usd === null || row.cost_usd === undefined ? null : Number(row.cost_usd),
    createdAt: String(row.created_at),
    createdByName: row.created_by_name === null ? null : String(row.created_by_name ?? ''),
    assignedTo: row.assigned_to === null ? null : String(row.assigned_to ?? ''),
    assignedToName: row.assigned_to_name === null ? null : String(row.assigned_to_name ?? ''),
    reviewStatus: String(row.review_status ?? 'unassigned') as ReviewStatus,
    reviewNotes: row.review_notes === null ? null : String(row.review_notes ?? ''),
  };
}

export interface SaveAuditInput {
  readonly organizationId: string;
  readonly userId: string | null;
  readonly audit: ContractAudit;
}

export async function saveAudit(input: SaveAuditInput): Promise<AuditSummaryRecord> {
  const sql = getSql();
  const { audit } = input;
  const id = newId('aud');

  const [row] = await sql`
    INSERT INTO audit_records (
      id, organization_id, created_by, source_name, vendor_name, contract_key,
      risk_score, risk_band, red_flag_count, critical_count,
      missing_clause_count, sla_violation_count, total_tokens, cost_usd, audit
    ) VALUES (
      ${id},
      ${input.organizationId},
      ${input.userId},
      ${audit.sourceName},
      ${vendorNameFrom(audit)},
      ${contractKeyFor(audit.sourceName)},
      ${audit.riskScore.overall},
      ${audit.riskScore.band},
      ${audit.redFlags.length},
      ${audit.riskScore.counts.critical},
      ${audit.missingClauses.length},
      ${audit.slaViolations.length},
      ${audit.metadata.telemetry.totalTokens},
      ${audit.metadata.telemetry.costUsd},
      ${JSON.stringify(audit)}
    )
    RETURNING *`;

  if (row === undefined) throw new Error('Salvataggio audit non riuscito.');
  return toSummary(row);
}

export interface ListAuditsFilter {
  readonly organizationId: string;
  readonly bands?: readonly RiskBand[];
  /** Ricerca su nome documento e fornitore. */
  readonly query?: string;
  readonly assignedTo?: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * Elenco filtrato.
 *
 * I filtri sono composti con `sql.query()` e parametri posizionali invece che
 * per concatenazione: una `WHERE` costruita interpolando il testo di ricerca è
 * il modo classico di regalare una SQL injection proprio nella schermata che
 * elenca i dati di tutti i clienti.
 */
export async function listAudits(filter: ListAuditsFilter): Promise<AuditSummaryRecord[]> {
  const sql = getSql();
  const conditions: string[] = ['a.organization_id = $1'];
  const params: unknown[] = [filter.organizationId];

  if (filter.bands !== undefined && filter.bands.length > 0) {
    params.push(filter.bands);
    conditions.push(`a.risk_band = ANY($${params.length})`);
  }

  if (filter.query !== undefined && filter.query.trim().length > 0) {
    params.push(`%${filter.query.trim()}%`);
    conditions.push(`(a.source_name ILIKE $${params.length} OR a.vendor_name ILIKE $${params.length})`);
  }

  if (filter.assignedTo !== undefined && filter.assignedTo.length > 0) {
    params.push(filter.assignedTo);
    conditions.push(`a.assigned_to = $${params.length}`);
  }

  params.push(Math.min(200, Math.max(1, filter.limit ?? 50)));
  const limitIndex = params.length;
  params.push(Math.max(0, filter.offset ?? 0));
  const offsetIndex = params.length;

  const rows = await sql.query(
    `SELECT a.*, c.name AS created_by_name, r.name AS assigned_to_name
     FROM audit_records a
     LEFT JOIN users c ON c.id = a.created_by
     LEFT JOIN users r ON r.id = a.assigned_to
     WHERE ${conditions.join(' AND ')}
     ORDER BY a.created_at DESC
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    params,
  );

  return (rows as Record<string, unknown>[]).map(toSummary);
}

export async function getAudit(
  organizationId: string,
  id: string,
): Promise<AuditDetailRecord | null> {
  const sql = getSql();
  // Il filtro per organizzazione sta nella query, non in un controllo dopo:
  // un `WHERE id = ...` seguito da un confronto applicativo funziona finché
  // qualcuno non dimentica il confronto.
  const rows = await sql`
    SELECT a.*, c.name AS created_by_name, r.name AS assigned_to_name
    FROM audit_records a
    LEFT JOIN users c ON c.id = a.created_by
    LEFT JOIN users r ON r.id = a.assigned_to
    WHERE a.id = ${id} AND a.organization_id = ${organizationId}
    LIMIT 1`;

  const row = rows[0];
  if (row === undefined) return null;
  return { ...toSummary(row), audit: row.audit as ContractAudit };
}

/** Versioni successive dello stesso contratto, dalla più recente. */
export async function listVersions(
  organizationId: string,
  contractKey: string,
): Promise<AuditSummaryRecord[]> {
  const sql = getSql();
  const rows = await sql`
    SELECT a.*, c.name AS created_by_name, r.name AS assigned_to_name
    FROM audit_records a
    LEFT JOIN users c ON c.id = a.created_by
    LEFT JOIN users r ON r.id = a.assigned_to
    WHERE a.organization_id = ${organizationId} AND a.contract_key = ${contractKey}
    ORDER BY a.created_at DESC
    LIMIT 50`;
  return rows.map(toSummary);
}

export async function assignReview(
  organizationId: string,
  auditId: string,
  assigneeId: string | null,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE audit_records
    SET assigned_to = ${assigneeId},
        review_status = ${assigneeId === null ? 'unassigned' : 'pending'}
    WHERE id = ${auditId} AND organization_id = ${organizationId}`;
}

export async function setReviewOutcome(
  organizationId: string,
  auditId: string,
  status: Exclude<ReviewStatus, 'unassigned'>,
  notes: string | null,
): Promise<void> {
  const sql = getSql();
  await sql`
    UPDATE audit_records
    SET review_status = ${status},
        review_notes = ${notes},
        reviewed_at = ${status === 'pending' ? null : new Date().toISOString()}
    WHERE id = ${auditId} AND organization_id = ${organizationId}`;
}

export interface HistoryStats {
  readonly total: number;
  readonly critical: number;
  readonly pendingReview: number;
  readonly averageScore: number | null;
}

export async function getHistoryStats(organizationId: string): Promise<HistoryStats> {
  const sql = getSql();
  const rows = await sql`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE risk_band = 'critical')::int AS critical,
      COUNT(*) FILTER (WHERE review_status = 'pending')::int AS pending,
      AVG(risk_score) AS average
    FROM audit_records
    WHERE organization_id = ${organizationId}`;

  const row = rows[0];
  return {
    total: Number(row?.total ?? 0),
    critical: Number(row?.critical ?? 0),
    pendingReview: Number(row?.pending ?? 0),
    averageScore: row?.average === null || row?.average === undefined ? null : Math.round(Number(row.average)),
  };
}

export interface VersionDelta {
  readonly scoreDelta: number;
  readonly redFlagDelta: number;
  readonly missingClauseDelta: number;
  readonly bandChanged: boolean;
  readonly direction: 'improved' | 'worsened' | 'unchanged';
}

/**
 * Confronto fra due versioni.
 *
 * Funzione pura, e il verso conta: un punteggio che **scende** è un
 * miglioramento, perché il punteggio misura il rischio. Invertirlo produrrebbe
 * una freccia verde su un contratto peggiorato, che è il modo più efficace di
 * far firmare la revisione sbagliata.
 */
export function compareVersions(
  older: Pick<AuditSummaryRecord, 'riskScore' | 'riskBand' | 'redFlagCount' | 'missingClauseCount'>,
  newer: Pick<AuditSummaryRecord, 'riskScore' | 'riskBand' | 'redFlagCount' | 'missingClauseCount'>,
): VersionDelta {
  const scoreDelta = newer.riskScore - older.riskScore;
  return {
    scoreDelta,
    redFlagDelta: newer.redFlagCount - older.redFlagCount,
    missingClauseDelta: newer.missingClauseCount - older.missingClauseCount,
    bandChanged: newer.riskBand !== older.riskBand,
    direction: scoreDelta < 0 ? 'improved' : scoreDelta > 0 ? 'worsened' : 'unchanged',
  };
}
