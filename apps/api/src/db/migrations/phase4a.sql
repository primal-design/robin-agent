-- Phase 4A: Memory foundation — business_memory_core, search, snapshots

-- ── Enable pgvector ───────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ── business_memory_core ──────────────────────────────────────────────────────
-- Bounded always-in-context memory. Small, typed, curated, security-scanned.
CREATE TABLE IF NOT EXISTS business_memory_core (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id   UUID,

  scope           TEXT        NOT NULL DEFAULT 'tenant',
  memory_key      TEXT        NOT NULL,
  memory_value    JSONB       NOT NULL DEFAULT '{}',

  source_type     TEXT        NOT NULL DEFAULT 'user',
  source_ref      TEXT,

  status          TEXT        NOT NULL DEFAULT 'active',
  security_status TEXT        NOT NULL DEFAULT 'approved',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bmc_status_check    CHECK (status IN ('active', 'archived')),
  CONSTRAINT bmc_sec_check       CHECK (security_status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT bmc_source_check    CHECK (source_type IN ('user', 'agent', 'system', 'integration')),
  UNIQUE (tenant_id, memory_key) -- partial unique index created separately for NULL owner_user_id
);

CREATE INDEX IF NOT EXISTS idx_bmc_tenant ON business_memory_core (tenant_id, status, security_status);

-- ── business_memory_search ────────────────────────────────────────────────────
-- Searchable semantic layer. Larger knowledge, retrieved on demand via pgvector.
CREATE TABLE IF NOT EXISTS business_memory_search (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id          UUID,

  source_type            TEXT        NOT NULL DEFAULT 'system',
  source_ref             TEXT,

  title                  TEXT        NOT NULL,
  content                TEXT        NOT NULL,
  metadata               JSONB       NOT NULL DEFAULT '{}',

  embedding              vector(1024),
  embedding_model        TEXT,
  embedding_content_hash TEXT,
  embedding_updated_at   TIMESTAMPTZ,

  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bms_tenant   ON business_memory_search (tenant_id);
CREATE INDEX IF NOT EXISTS idx_bms_source   ON business_memory_search (tenant_id, source_type);
-- Vector similarity index (requires at least one row to build on Neon free tier)
-- CREATE INDEX IF NOT EXISTS idx_bms_embedding ON business_memory_search USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── business_memory_snapshots ─────────────────────────────────────────────────
-- Frozen memory block used for a specific agent run. Reproducibility + debug.
CREATE TABLE IF NOT EXISTS business_memory_snapshots (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_run_id           UUID,
  conversation_id      UUID        REFERENCES conversations(id) ON DELETE SET NULL,

  memory_block         JSONB       NOT NULL,
  memory_version_hash  TEXT        NOT NULL,
  token_estimate       INTEGER,

  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bmsnap_tenant  ON business_memory_snapshots (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bmsnap_run     ON business_memory_snapshots (job_run_id);
CREATE INDEX IF NOT EXISTS idx_bmsnap_conv    ON business_memory_snapshots (conversation_id);

-- ── Migrate existing business_memory rows into business_memory_core ───────────
INSERT INTO business_memory_core (tenant_id, memory_key, memory_value, source_type, status, security_status)
SELECT
  tenant_id,
  key,
  to_jsonb(value),
  'user',
  'active',
  'approved'
FROM business_memory
ON CONFLICT (tenant_id, owner_user_id, memory_key) DO UPDATE
  SET memory_value = EXCLUDED.memory_value,
      updated_at   = now();

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE business_memory_core     ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory_core     FORCE  ROW LEVEL SECURITY;
ALTER TABLE business_memory_search   ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory_search   FORCE  ROW LEVEL SECURITY;
ALTER TABLE business_memory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory_snapshots FORCE  ROW LEVEL SECURITY;

CREATE POLICY bmc_tenant_isolation ON business_memory_core
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY bms_tenant_isolation ON business_memory_search
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

CREATE POLICY bmsnap_tenant_isolation ON business_memory_snapshots
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);
