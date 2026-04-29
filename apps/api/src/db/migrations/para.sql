-- PARA memory tables for Robin
-- Run this once on your Neon database

CREATE TABLE IF NOT EXISTS para_notes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  para_type   TEXT NOT NULL CHECK (para_type IN ('project', 'area', 'resource', 'archive')),
  title       TEXT NOT NULL,
  section     TEXT NOT NULL CHECK (section IN ('what_happened', 'robin_notes', 'open_threads', 'decisions')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS para_notes_user_id_idx ON para_notes(user_id);
CREATE INDEX IF NOT EXISTS para_notes_type_idx    ON para_notes(user_id, para_type);

CREATE TABLE IF NOT EXISTS daily_logs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL DEFAULT CURRENT_DATE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'robin')),
  content     TEXT NOT NULL,
  logged_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_logs_user_date_idx ON daily_logs(user_id, date);
