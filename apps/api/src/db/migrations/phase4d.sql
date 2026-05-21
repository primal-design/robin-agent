-- Phase 4D: Scale — tenant_limits, per-tenant quota enforcement

-- ── tenant_limits ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenant_limits (
  tenant_id               UUID    PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,

  max_scheduled_jobs      INTEGER NOT NULL DEFAULT 20,
  max_runs_per_day        INTEGER NOT NULL DEFAULT 100,
  max_concurrent_runs     INTEGER NOT NULL DEFAULT 5,
  max_llm_calls_per_minute INTEGER NOT NULL DEFAULT 10,
  max_tokens_per_day      INTEGER NOT NULL DEFAULT 500000,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed default limits for existing tenants
INSERT INTO tenant_limits (tenant_id)
SELECT id FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- ── job_run daily counter view ────────────────────────────────────────────────
-- Used by dispatcher to enforce max_runs_per_day without a separate counter table.
CREATE OR REPLACE VIEW tenant_daily_run_counts AS
SELECT
  tenant_id,
  COUNT(*) AS runs_today
FROM job_runs
WHERE started_at >= CURRENT_DATE
  AND status != 'failed'
GROUP BY tenant_id;
