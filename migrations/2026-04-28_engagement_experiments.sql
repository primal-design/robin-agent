ALTER TABLE users ADD COLUMN IF NOT EXISTS engagement_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS engagement_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS experiments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  variants JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS experiment_assignments (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  variant TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, experiment_id)
);

CREATE TABLE IF NOT EXISTS experiment_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  experiment_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_experiment_events_experiment_created ON experiment_events(experiment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_experiment_events_user_created ON experiment_events(user_id, created_at DESC);
