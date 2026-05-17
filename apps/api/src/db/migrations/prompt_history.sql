-- Runtime prompt override column (nullable — null means use file baseline)
ALTER TABLE workers ADD COLUMN IF NOT EXISTS runtime_prompt TEXT DEFAULT NULL;

-- Prompt history: every save logged with full content + who + when
CREATE TABLE IF NOT EXISTS prompt_history (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID REFERENCES tenants(id),
  worker_id   UUID REFERENCES workers(id),
  prompt      TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'dashboard', -- 'dashboard' | 'rollback' | 'api'
  saved_by    TEXT NOT NULL DEFAULT 'human',
  created_at  TIMESTAMPTZ DEFAULT now()
);
