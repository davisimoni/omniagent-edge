-- ============================================================================
-- OmniAgent Edge — schema applicativo (utenti, workspace, audit, consumi)
--
--   psql "$DATABASE_URL" -f db/schema-app.sql
--
-- Separato da `db/schema.sql` (vector store) di proposito: sono due cicli di
-- vita diversi. Il vector store si può svuotare e ripopolare da uno script di
-- ingest; questo contiene account, report firmati e contatori di consumo, e una
-- sua ricreazione è una perdita di dati, non un'operazione di manutenzione.
--
-- Ogni tabella con dati di tenant porta `organization_id` e ogni query del
-- repository filtra su quella colonna. L'isolamento sta nel layer di accesso
-- (`lib/audits/repository.ts`, `lib/auth/repository.ts`), non nei chiamanti.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Organizzazioni (workspace) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id                     TEXT PRIMARY KEY,
  name                   TEXT        NOT NULL,
  slug                   TEXT        NOT NULL UNIQUE,
  -- Piano corrente. Stringa e non ENUM: aggiungere un piano è una decisione
  -- commerciale e non deve richiedere una migrazione dello schema.
  plan                   TEXT        NOT NULL DEFAULT 'free',
  plan_status            TEXT        NOT NULL DEFAULT 'active',
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  current_period_end     TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS organizations_stripe_customer_idx
  ON organizations (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- ── Utenti ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  -- Normalizzata in minuscolo dal layer applicativo prima di ogni scrittura e
  -- lettura: senza, "Mario@x.it" e "mario@x.it" diventerebbero due account.
  email          TEXT        NOT NULL UNIQUE,
  password_hash  TEXT        NOT NULL,
  name           TEXT        NOT NULL,
  -- Incrementata a ogni cambio password: le sessioni sono cookie firmati e
  -- senza stato, e questo contatore è l'unico modo per invalidarle tutte
  -- insieme senza tenere una tabella di sessioni.
  session_version INTEGER    NOT NULL DEFAULT 1,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at  TIMESTAMPTZ
);

-- ── Appartenenze ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memberships (
  user_id         TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL DEFAULT 'member',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, organization_id)
);

CREATE INDEX IF NOT EXISTS memberships_org_idx ON memberships (organization_id);

-- ── Audit archiviati ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_records (
  id                    TEXT PRIMARY KEY,
  organization_id       TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  created_by            TEXT        REFERENCES users(id) ON DELETE SET NULL,
  source_name           TEXT        NOT NULL,
  vendor_name           TEXT,
  -- Chiave di identità del contratto: normalizzazione di `source_name`. È ciò
  -- che tiene insieme le versioni successive dello stesso documento, e quindi
  -- ciò che rende possibile il confronto temporale.
  contract_key          TEXT        NOT NULL,
  risk_score            INTEGER     NOT NULL,
  risk_band             TEXT        NOT NULL,
  red_flag_count        INTEGER     NOT NULL DEFAULT 0,
  critical_count        INTEGER     NOT NULL DEFAULT 0,
  missing_clause_count  INTEGER     NOT NULL DEFAULT 0,
  sla_violation_count   INTEGER     NOT NULL DEFAULT 0,
  total_tokens          INTEGER     NOT NULL DEFAULT 0,
  cost_usd              NUMERIC(12, 6),
  -- Il report integrale. JSONB e non una decina di tabelle normalizzate: un
  -- audit è un documento immutabile, si legge sempre intero e la sua forma è
  -- già garantita da `contractAuditSchema`. Normalizzarlo aggiungerebbe join
  -- per un'entità che nessuno interroga per campo.
  audit                 JSONB       NOT NULL,
  -- Flusso di revisione umana.
  assigned_to           TEXT        REFERENCES users(id) ON DELETE SET NULL,
  review_status         TEXT        NOT NULL DEFAULT 'unassigned',
  review_notes          TEXT,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- L'elenco è sempre filtrato per organizzazione e ordinato per data: l'indice
-- composto serve entrambe le cose in una sola scansione.
CREATE INDEX IF NOT EXISTS audit_records_org_created_idx
  ON audit_records (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_records_contract_idx
  ON audit_records (organization_id, contract_key, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_records_band_idx
  ON audit_records (organization_id, risk_band);
CREATE INDEX IF NOT EXISTS audit_records_assignee_idx
  ON audit_records (assigned_to) WHERE assigned_to IS NOT NULL;

-- ── Consumi ─────────────────────────────────────────────────────────────────
-- Registro append-only invece di un contatore da incrementare: un contatore
-- non dice *quando* è stata consumata la quota, quindi non permette di
-- azzerarla per periodo né di mostrare all'utente dove sono finiti i crediti.
CREATE TABLE IF NOT EXISTS usage_events (
  id              TEXT PRIMARY KEY,
  organization_id TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         TEXT        REFERENCES users(id) ON DELETE SET NULL,
  kind            TEXT        NOT NULL,
  units           INTEGER     NOT NULL DEFAULT 1,
  cost_usd        NUMERIC(12, 6),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usage_events_org_kind_created_idx
  ON usage_events (organization_id, kind, created_at DESC);

-- ── Inviti ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invitations (
  id              TEXT PRIMARY KEY,
  organization_id TEXT        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  role            TEXT        NOT NULL DEFAULT 'member',
  -- Solo il digest del token: un invito in chiaro nel database è un accesso al
  -- workspace leggibile da qualunque copia di quel database.
  token_hash      TEXT        NOT NULL UNIQUE,
  invited_by      TEXT        REFERENCES users(id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invitations_org_idx ON invitations (organization_id);

-- ── Notifiche ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_settings (
  organization_id   TEXT PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  slack_webhook_url TEXT,
  teams_webhook_url TEXT,
  email_recipients  TEXT[] NOT NULL DEFAULT '{}',
  -- Soglia di gravità oltre la quale si notifica. Default: solo i critici —
  -- un canale che riceve ogni rilievo viene silenziato entro una settimana, e
  -- da quel momento non avvisa più nemmeno dei critici.
  notify_from_band  TEXT   NOT NULL DEFAULT 'critical',
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
