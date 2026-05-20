-- Phase 3: Goal mode, cron scheduler, job runs, artifacts

-- ── Goals ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS goals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  worker_id       UUID        NOT NULL REFERENCES workers(id)  ON DELETE CASCADE,
  conversation_id UUID        REFERENCES conversations(id)     ON DELETE SET NULL,
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'active',
  progress        TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,

  CONSTRAINT goals_status_check
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_goals_tenant     ON goals (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_goals_conv       ON goals (conversation_id, status);

-- ── Scheduled jobs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS scheduled_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  worker_id       UUID        NOT NULL REFERENCES workers(id)  ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  task            TEXT        NOT NULL,
  cron_expression TEXT        NOT NULL,
  output_chat_id  BIGINT,
  enabled         BOOLEAN     NOT NULL DEFAULT true,
  last_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_tenant ON scheduled_jobs (tenant_id, enabled);

-- ── Job runs ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_runs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id       UUID        NOT NULL REFERENCES scheduled_jobs(id) ON DELETE CASCADE,
  tenant_id    UUID        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'running',
  output       TEXT,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,

  CONSTRAINT job_runs_status_check
    CHECK (status IN ('running', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_job_runs_job ON job_runs (job_id, started_at DESC);

-- ── Artifacts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS artifacts (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID        REFERENCES conversations(id)    ON DELETE SET NULL,
  goal_id         UUID        REFERENCES goals(id)            ON DELETE SET NULL,
  job_id          UUID        REFERENCES scheduled_jobs(id)   ON DELETE SET NULL,
  title           TEXT        NOT NULL,
  content         TEXT        NOT NULL,
  type            TEXT        NOT NULL DEFAULT 'text',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT artifacts_type_check
    CHECK (type IN ('text', 'report', 'plan', 'analysis', 'draft', 'summary'))
);

CREATE INDEX IF NOT EXISTS idx_artifacts_tenant ON artifacts (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_goal   ON artifacts (goal_id,   created_at DESC);
