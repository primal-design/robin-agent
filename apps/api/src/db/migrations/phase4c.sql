-- Phase 4C: Memory learning layer — candidates, security reviews, events

-- ── business_memory_candidates ────────────────────────────────────────────────
-- Agent-learned memory proposals. Must pass security review before promotion.
CREATE TABLE IF NOT EXISTS business_memory_candidates (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  owner_user_id         UUID,

  target_layer          TEXT        NOT NULL DEFAULT 'core',
  proposed_scope        TEXT        NOT NULL DEFAULT 'tenant',
  proposed_memory_key   TEXT        NOT NULL,
  proposed_memory_value JSONB       NOT NULL DEFAULT '{}',
  proposed_content      TEXT,

  source_type           TEXT        NOT NULL DEFAULT 'agent',
  source_ref            TEXT,
  reason                TEXT,

  risk_level            TEXT        NOT NULL DEFAULT 'low',
  requires_approval     BOOLEAN     NOT NULL DEFAULT false,

  status                TEXT        NOT NULL DEFAULT 'pending',
  reviewed_at           TIMESTAMPTZ,
  reviewed_by_user_id   UUID,

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bmc_target_check    CHECK (target_layer IN ('core', 'search')),
  CONSTRAINT bmc_risk_check      CHECK (risk_level IN ('low', 'medium', 'high')),
  CONSTRAINT bmc_status_check    CHECK (status IN ('pending', 'approved', 'rejected', 'promoted')),
  CONSTRAINT bmc_source2_check   CHECK (source_type IN ('user', 'agent', 'system', 'integration'))
);

CREATE INDEX IF NOT EXISTS idx_bmcand_tenant  ON business_memory_candidates (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_bmcand_pending ON business_memory_candidates (tenant_id, risk_level)
  WHERE status = 'pending';

-- ── business_memory_security_reviews ─────────────────────────────────────────
-- Security scan results for candidates before core promotion.
CREATE TABLE IF NOT EXISTS business_memory_security_reviews (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  candidate_id UUID        NOT NULL REFERENCES business_memory_candidates(id) ON DELETE CASCADE,

  status       TEXT        NOT NULL DEFAULT 'pending',
  risk_reasons JSONB       NOT NULL DEFAULT '[]',

  scanned_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bmsr_status_check CHECK (status IN ('pending', 'passed', 'flagged', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_bmsr_candidate ON business_memory_security_reviews (candidate_id);
CREATE INDEX IF NOT EXISTS idx_bmsr_tenant    ON business_memory_security_reviews (tenant_id, status);

-- ── business_memory_events ────────────────────────────────────────────────────
-- Append-only audit log of all memory changes.
CREATE TABLE IF NOT EXISTS business_memory_events (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  memory_layer     TEXT        NOT NULL,
  core_memory_id   UUID        REFERENCES business_memory_core(id)   ON DELETE SET NULL,
  search_memory_id UUID        REFERENCES business_memory_search(id) ON DELETE SET NULL,
  candidate_id     UUID        REFERENCES business_memory_candidates(id) ON DELETE SET NULL,

  action           TEXT        NOT NULL,
  before_value     JSONB,
  after_value      JSONB,

  reason           TEXT,
  actor_type       TEXT        NOT NULL DEFAULT 'system',
  actor_user_id    UUID,

  job_run_id       UUID,
  source_type      TEXT,
  source_ref       TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT bme_layer_check  CHECK (memory_layer IN ('core', 'search', 'candidate')),
  CONSTRAINT bme_actor_check  CHECK (actor_type IN ('user', 'agent', 'system', 'integration')),
  CONSTRAINT bme_action_check CHECK (action IN (
    'created', 'updated', 'archived', 'promoted', 'rejected',
    'security_flagged', 'security_passed', 'security_blocked',
    'sync_completed', 'sync_failed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_bme_tenant ON business_memory_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bme_core   ON business_memory_events (core_memory_id)
  WHERE core_memory_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────
ALTER TABLE business_memory_candidates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory_candidates       FORCE  ROW LEVEL SECURITY;
ALTER TABLE business_memory_security_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory_security_reviews FORCE  ROW LEVEL SECURITY;
ALTER TABLE business_memory_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory_events           FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bmcand_tenant_isolation ON business_memory_candidates;
CREATE POLICY bmcand_tenant_isolation ON business_memory_candidates
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS bmsr_tenant_isolation ON business_memory_security_reviews;
CREATE POLICY bmsr_tenant_isolation ON business_memory_security_reviews
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

DROP POLICY IF EXISTS bme_tenant_isolation ON business_memory_events;
CREATE POLICY bme_tenant_isolation ON business_memory_events
  USING (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);
