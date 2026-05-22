-- Phase 5A: Connector Grants + Read-only Ingestion

-- ── tenant_data_source_grants ─────────────────────────────────────────────────
-- One row per (tenant, provider). Stores OAuth state and sync metadata.
-- Tokens are not separately encrypted here — same approach as gmail_tokens.
CREATE TABLE IF NOT EXISTS tenant_data_source_grants (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  worker_id         UUID        REFERENCES workers(id) ON DELETE SET NULL,

  provider          TEXT        NOT NULL,   -- 'gmail', 'gdrive'
  status            TEXT        NOT NULL DEFAULT 'connected',
  -- 'connected', 'disconnected', 'error'

  access_token      TEXT,
  refresh_token     TEXT,
  token_expiry      BIGINT,
  scopes            TEXT[]      NOT NULL DEFAULT '{}',
  connected_email   TEXT,
  connected_by      TEXT,       -- phone of the user who authorised

  sync_enabled      BOOLEAN     NOT NULL DEFAULT true,
  last_synced_at    TIMESTAMPTZ,
  last_sync_status  TEXT,       -- 'ok', 'error'
  last_sync_error   TEXT,
  last_sync_count   INTEGER,    -- items ingested in last sync

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tdsg_status_check   CHECK (status IN ('connected', 'disconnected', 'error')),
  CONSTRAINT tdsg_provider_check CHECK (provider IN ('gmail', 'gdrive')),
  UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_tdsg_tenant   ON tenant_data_source_grants (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tdsg_sync     ON tenant_data_source_grants (provider, sync_enabled)
  WHERE status = 'connected';

-- RLS: server-internal, no direct user queries
ALTER TABLE tenant_data_source_grants DISABLE ROW LEVEL SECURITY;

-- ── Add sync_source_ref index to business_memory_search ──────────────────────
-- Allows efficient upsert/dedup when re-syncing the same message.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bms_source_ref
  ON business_memory_search (tenant_id, source_type, source_ref)
  WHERE source_ref IS NOT NULL;

-- ── Extend business_memory_events action enum ─────────────────────────────────
ALTER TABLE business_memory_events
  DROP CONSTRAINT IF EXISTS bme_action_check;

ALTER TABLE business_memory_events
  ADD CONSTRAINT bme_action_check CHECK (action IN (
    'created', 'updated', 'archived', 'promoted', 'rejected',
    'security_flagged', 'security_passed', 'security_blocked',
    'sync_completed', 'sync_failed'
  ));
