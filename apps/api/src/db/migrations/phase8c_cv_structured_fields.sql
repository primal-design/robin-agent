-- Add structured CV fields: work_history, education, certifications, languages
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS work_history    JSONB    NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS education       JSONB    NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS certifications  TEXT[]   NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS languages       TEXT[]   NOT NULL DEFAULT '{}';
