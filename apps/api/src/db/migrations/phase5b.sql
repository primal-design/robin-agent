-- Phase 5B: Connector hardening — encrypted tokens, sync runs, quota, embedding queue

-- ── Rename token columns to make encryption explicit ─────────────────────────
ALTER TABLE tenant_data_source_grants
  RENAME COLUMN access_token  TO access_token_enc;

ALTER TABLE tenant_data_source_grants
  RENAME COLUMN refresh_token TO refresh_token_enc;

-- ── connector_sync_runs ───────────────────────────────────────────────────────
-- One row per sync invocation. Audit log for connector syncs.
CREATE TABLE IF NOT EXISTS connector_sync_runs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  grant_id       UUID        NOT NULL REFERENCES tenant_data_source_grants(id) ON DELETE CASCADE,
  provider       TEXT        NOT NULL,

  trigger        TEXT        NOT NULL DEFAULT 'scheduled',  -- 'manual', 'scheduled'
  status         TEXT        NOT NULL DEFAULT 'running',    -- 'running', 'ok', 'error', 'skipped'
  items_ingested INTEGER,
  candidates_created INTEGER,
  error_message  TEXT,

  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,

  CONSTRAINT csr_status_check   CHECK (status IN ('running', 'ok', 'error', 'skipped')),
  CONSTRAINT csr_trigger_check  CHECK (trigger IN ('manual', 'scheduled'))
);

CREATE INDEX IF NOT EXISTS idx_csr_grant  ON connector_sync_runs (grant_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_csr_tenant ON connector_sync_runs (tenant_id, started_at DESC);

-- ── Per-tenant connector sync quota ──────────────────────────────────────────
ALTER TABLE tenant_limits
  ADD COLUMN IF NOT EXISTS max_connector_syncs_per_day INTEGER NOT NULL DEFAULT 48;

-- ── Embedding queue marker ────────────────────────────────────────────────────
-- Rows with NULL embedding are pending; embedding_queued_at tracks when queued.
ALTER TABLE business_memory_search
  ADD COLUMN IF NOT EXISTS embedding_queued_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bms_embed_queue
  ON business_memory_search (tenant_id, created_at)
  WHERE embedding IS NULL AND embedding_queued_at IS NULL;
