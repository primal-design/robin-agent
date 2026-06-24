-- Phase 8b: Extended profile fields for smarter matching
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS seniority              TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS current_or_recent_role TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS domains                TEXT[] DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS work_authorisation     TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS notice_period          TEXT;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS avoid_roles            TEXT[] DEFAULT '{}';
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS confirmed_fields       TEXT[] DEFAULT '{}';
