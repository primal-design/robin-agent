CREATE TABLE IF NOT EXISTS lifecycle_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  event_type TEXT NOT NULL,
  channel TEXT,
  reason TEXT,
  urgency TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_events_user_created ON lifecycle_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lifecycle_events_stage_created ON lifecycle_events(stage, created_at DESC);

ALTER TABLE users ADD COLUMN IF NOT EXISTS lifecycle_stage TEXT NOT NULL DEFAULT 'new';
ALTER TABLE users ADD COLUMN IF NOT EXISTS lifecycle_updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_nudged_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_nudge_channel TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_inbound_whatsapp_at TIMESTAMPTZ;
