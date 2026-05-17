CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE workers
  ADD COLUMN IF NOT EXISTS runtime_prompt_override          TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS runtime_prompt_override_updated_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS runtime_prompt_override_updated_by TEXT        DEFAULT NULL;

CREATE TABLE IF NOT EXISTS prompt_history (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  worker_id   UUID        NOT NULL REFERENCES workers(id)  ON DELETE CASCADE,
  old_prompt  TEXT,
  new_prompt  TEXT,
  diff        TEXT,
  action      TEXT        NOT NULL DEFAULT 'save',
  source      TEXT        NOT NULL DEFAULT 'dashboard',
  saved_by    TEXT        NOT NULL DEFAULT 'human',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT prompt_history_action_check
    CHECK (action IN ('save', 'rollback', 'clear_override')),
  CONSTRAINT prompt_history_source_check
    CHECK (source IN ('dashboard', 'repo_baseline', 'api', 'rollback'))
);

CREATE INDEX IF NOT EXISTS idx_prompt_history_worker ON prompt_history (worker_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_history_tenant ON prompt_history (tenant_id, created_at DESC);
