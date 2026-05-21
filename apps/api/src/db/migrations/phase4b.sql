-- Phase 4B: Scheduler rewrite — next_run_at dispatcher, idempotency, outbound_actions

-- ── Extend scheduled_jobs ─────────────────────────────────────────────────────
ALTER TABLE scheduled_jobs
  ADD COLUMN IF NOT EXISTS timezone         TEXT        NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS execution_mode   TEXT        NOT NULL DEFAULT 'agent_only',
  ADD COLUMN IF NOT EXISTS memory_policy    JSONB       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS output_contract  JSONB       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS next_run_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_scheduled_for  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_dispatched_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_completed_at   TIMESTAMPTZ;

ALTER TABLE scheduled_jobs
  ADD CONSTRAINT sj_exec_mode_check
    CHECK (execution_mode IN ('script_only', 'script_plus_agent', 'agent_only'));

-- Backfill next_run_at for existing enabled jobs (run them within the next minute)
UPDATE scheduled_jobs
  SET next_run_at = now() + interval '30 seconds'
  WHERE enabled = true AND next_run_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_sj_dispatch
  ON scheduled_jobs (next_run_at ASC)
  WHERE enabled = true;

-- ── Extend job_runs ───────────────────────────────────────────────────────────
ALTER TABLE job_runs
  ADD COLUMN IF NOT EXISTS scheduled_for    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key  TEXT,
  ADD COLUMN IF NOT EXISTS bullmq_job_id    TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count    INTEGER     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS input_context    JSONB,
  ADD COLUMN IF NOT EXISTS error            TEXT,
  ADD COLUMN IF NOT EXISTS queued_at        TIMESTAMPTZ;

-- Rename output_chat_id column reference — output stored in output col (already exists)
-- Unique constraint: one run per job per scheduled slot
ALTER TABLE job_runs
  DROP CONSTRAINT IF EXISTS job_runs_idempotency_unique;
ALTER TABLE job_runs
  ADD CONSTRAINT job_runs_idempotency_unique
    UNIQUE (tenant_id, idempotency_key);

-- ── outbound_actions ──────────────────────────────────────────────────────────
-- Idempotency guard for all outbound side effects. Prevents double-send on retry.
CREATE TABLE IF NOT EXISTS outbound_actions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_run_id        UUID        REFERENCES job_runs(id)         ON DELETE SET NULL,
  conversation_id   UUID        REFERENCES conversations(id)    ON DELETE SET NULL,

  action_type       TEXT        NOT NULL,
  target_key        TEXT        NOT NULL,
  idempotency_key   TEXT        NOT NULL,
  payload_hash      TEXT,

  status            TEXT        NOT NULL DEFAULT 'pending',
  provider_message_id TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at           TIMESTAMPTZ,

  CONSTRAINT oa_status_check CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_oa_tenant  ON outbound_actions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_oa_run     ON outbound_actions (job_run_id);

-- RLS
ALTER TABLE outbound_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE outbound_actions FORCE  ROW LEVEL SECURITY;

CREATE POLICY oa_tenant_isolation ON outbound_actions
  USING (tenant_id = current_setting('app.current_tenant', true)::uuid);

-- Disable RLS on scheduler tables (server-internal, not user data)
ALTER TABLE scheduled_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE job_runs        DISABLE ROW LEVEL SECURITY;
