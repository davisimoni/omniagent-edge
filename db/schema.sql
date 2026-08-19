-- ============================================================================
-- OmniAgent Edge — schema del vector store (PostgreSQL + pgvector)
--
-- Compatibile con Neon e Supabase. Eseguire una volta sul database di
-- destinazione (regione UE, es. eu-central-1 / Francoforte).
--
--   psql "$DATABASE_URL" -f db/schema.sql
--
-- ATTENZIONE: la dimensione `vector(1024)` deve combaciare con la variabile
-- d'ambiente EMBEDDING_DIMENSIONS. Cambiarne una sola delle due produce un
-- errore a runtime sulla prima query, non un risultato silenziosamente sbagliato.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  source      TEXT        NOT NULL DEFAULT 'unknown',
  -- Namespace logico per l'isolamento multi-tenant. Ogni query DEVE filtrare
  -- su questa colonna: l'enforcement sta nel layer di accesso (lib/vector.ts),
  -- non nei singoli chiamanti.
  tenant_id   TEXT        NOT NULL DEFAULT 'public',
  metadata    JSONB       NOT NULL DEFAULT '{}'::jsonb,
  embedding   vector(1024),
  -- Colonna generata: il vettore full-text resta sempre allineato al contenuto,
  -- senza trigger da mantenere e senza righe che sfuggono all'indice.
  tsv         tsvector GENERATED ALWAYS AS (
                to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
              ) STORED,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ricerca semantica: HNSW su distanza coseno (`<=>`).
-- HNSW ha recall migliore di IVFFlat sui corpus piccoli e non richiede un
-- passo di training, quindi funziona anche su una tabella appena popolata.
CREATE INDEX IF NOT EXISTS documents_embedding_hnsw_idx
  ON documents USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- Ricerca lessicale: GIN sul tsvector.
CREATE INDEX IF NOT EXISTS documents_tsv_idx
  ON documents USING gin (tsv);

-- Il filtro di tenant precede sempre la ricerca: indicizzarlo evita che
-- l'isolamento multi-tenant costi una scansione completa.
CREATE INDEX IF NOT EXISTS documents_tenant_idx
  ON documents (tenant_id);

-- ── Seed opzionale ──────────────────────────────────────────────────────────
-- Righe senza `embedding` restano invisibili alla ricerca semantica ma sono
-- già cercabili per keyword: popolare gli embedding con uno script di ingest.
INSERT INTO documents (id, title, content, source, metadata) VALUES
  ('doc-sla-001',
   'SLA Enterprise — tempi di risposta',
   'Il contratto Enterprise garantisce un primo riscontro entro 1 ora per gli incidenti di severità 1, entro 4 ore per la severità 2 ed entro un giorno lavorativo per la severità 3. La disponibilità mensile garantita è del 99.95%.',
   'contracts/sla-enterprise.md',
   '{"category":"legal","version":"2026-01"}'),
  ('doc-onb-002',
   'Onboarding cliente — checklist',
   'L''attivazione di un nuovo cliente Enterprise prevede kickoff call entro 3 giorni, provisioning del tenant dedicato, import dei dati storici e una sessione di formazione da 90 minuti.',
   'playbooks/onboarding.md',
   '{"category":"ops","version":"2026-03"}')
ON CONFLICT (id) DO NOTHING;
