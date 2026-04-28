ALTER TABLE experiments ADD COLUMN IF NOT EXISTS winning_variant TEXT;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS winner_updated_at TIMESTAMPTZ;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS min_sample_size INTEGER NOT NULL DEFAULT 20;
ALTER TABLE experiments ADD COLUMN IF NOT EXISTS exploration_rate NUMERIC(5,2) NOT NULL DEFAULT 0.15;
ALTER TABLE experiment_assignments ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE experiment_assignments ADD COLUMN IF NOT EXISTS exposures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE experiment_assignments ADD COLUMN IF NOT EXISTS conversions INTEGER NOT NULL DEFAULT 0;

INSERT INTO experiments (id, name, variants)
VALUES (
  'nudge_tone_v1',
  'Nudge tone auto-learning',
  '["soft", "direct", "challenge"]'::jsonb
)
ON CONFLICT (id) DO NOTHING;
