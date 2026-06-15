-- Phase 12: FEN Job Agent
-- Tables: user_profiles, jobs, job_sources, job_fetch_runs, job_matches,
--         applications, application_events, resumes, cover_letters,
--         email_connections, email_events

-- ── user_profiles ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name           TEXT,
  headline            TEXT,
  location            TEXT,
  target_roles        TEXT[]      NOT NULL DEFAULT '{}',
  target_locations    TEXT[]      NOT NULL DEFAULT '{}',
  min_salary          INTEGER,
  preferred_work_type TEXT        NOT NULL DEFAULT 'any',
  skills              TEXT[]      NOT NULL DEFAULT '{}',
  experience_years    INTEGER,
  raw_cv_text         TEXT,
  embedding           VECTOR(1024),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT user_profiles_work_type_check CHECK (
    preferred_work_type IN ('remote', 'hybrid', 'onsite', 'any')
  )
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_tenant
  ON user_profiles (tenant_id);

CREATE INDEX IF NOT EXISTS idx_user_profiles_embedding
  ON user_profiles USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50)
  WHERE embedding IS NOT NULL;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_profiles_tenant ON user_profiles;
CREATE POLICY user_profiles_tenant ON user_profiles
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON user_profiles TO fen_app;

-- ── job_sources ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_sources (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL UNIQUE,   -- 'adzuna', 'reed', 'remotive'
  enabled     BOOLEAN     NOT NULL DEFAULT true,
  config      JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO job_sources (name, enabled, config) VALUES
  ('adzuna',   true, '{"base_url":"https://api.adzuna.com/v1/api/jobs/gb/search","results_per_page":50}'),
  ('reed',     true, '{"base_url":"https://www.reed.co.uk/api/1.0/search","results_per_page":100}'),
  ('remotive', true, '{"base_url":"https://remotive.com/api/remote-jobs"}')
ON CONFLICT (name) DO NOTHING;

GRANT SELECT ON job_sources TO fen_app;

-- ── job_fetch_runs ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_fetch_runs (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source        TEXT        NOT NULL,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  jobs_fetched  INTEGER     NOT NULL DEFAULT 0,
  jobs_new      INTEGER     NOT NULL DEFAULT 0,
  error         TEXT,
  success       BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_job_fetch_runs_source
  ON job_fetch_runs (source, started_at DESC);

GRANT SELECT, INSERT, UPDATE ON job_fetch_runs TO fen_app;

-- ── jobs ──────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source          TEXT        NOT NULL,
  external_id     TEXT        NOT NULL,
  title           TEXT        NOT NULL,
  company         TEXT,
  location        TEXT,
  country         TEXT        NOT NULL DEFAULT 'GB',
  salary_min      INTEGER,
  salary_max      INTEGER,
  currency        TEXT        NOT NULL DEFAULT 'GBP',
  employment_type TEXT,                    -- 'full_time','part_time','contract','freelance'
  remote_type     TEXT,                    -- 'remote','hybrid','onsite'
  seniority       TEXT,                    -- 'junior','mid','senior','lead','director'
  description     TEXT,
  url             TEXT,
  raw_payload     JSONB       NOT NULL DEFAULT '{}',
  posted_at       TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  embedding       VECTOR(1024),

  CONSTRAINT jobs_source_external UNIQUE (source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_jobs_active_posted
  ON jobs (is_active, posted_at DESC)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_jobs_embedding
  ON jobs USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100)
  WHERE embedding IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_source
  ON jobs (source, fetched_at DESC);

GRANT SELECT, INSERT, UPDATE ON jobs TO fen_app;

-- ── job_matches ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS job_matches (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id        UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  job_id            UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  suitability_score INTEGER     NOT NULL CHECK (suitability_score BETWEEN 0 AND 100),
  score_breakdown   JSONB       NOT NULL DEFAULT '{}',
  match_reasons     TEXT[]      NOT NULL DEFAULT '{}',
  missing_skills    TEXT[]      NOT NULL DEFAULT '{}',
  llm_summary       TEXT,
  sent_to_telegram  BOOLEAN     NOT NULL DEFAULT false,
  user_feedback     TEXT,                  -- 'interested','skip','not_relevant'
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT job_matches_profile_job UNIQUE (profile_id, job_id)
);

CREATE INDEX IF NOT EXISTS idx_job_matches_tenant_score
  ON job_matches (tenant_id, suitability_score DESC)
  WHERE user_feedback IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_matches_profile_unsent
  ON job_matches (profile_id, suitability_score DESC)
  WHERE sent_to_telegram = false AND user_feedback IS NULL;

ALTER TABLE job_matches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_matches_tenant ON job_matches;
CREATE POLICY job_matches_tenant ON job_matches
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON job_matches TO fen_app;

-- ── applications ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  profile_id         UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  job_id             UUID        NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  status             TEXT        NOT NULL DEFAULT 'matched',
  application_method TEXT,                  -- 'email','url','manual'
  application_url    TEXT,
  applying_email     TEXT,
  tailored_cv_id     UUID,
  cover_letter_id    UUID,
  match_score        INTEGER,
  approved_at        TIMESTAMPTZ,
  applied_at         TIMESTAMPTZ,
  last_update_at     TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT applications_status_check CHECK (status IN (
    'matched','interested','drafting','draft_ready',
    'approved','applied','interview','assessment',
    'offer','rejected','withdrawn'
  ))
);

CREATE INDEX IF NOT EXISTS idx_applications_tenant_status
  ON applications (tenant_id, status, last_update_at DESC);

CREATE INDEX IF NOT EXISTS idx_applications_profile
  ON applications (profile_id, status);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS applications_tenant ON applications;
CREATE POLICY applications_tenant ON applications
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON applications TO fen_app;

-- ── application_events ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS application_events (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  application_id UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  event_type     TEXT        NOT NULL,
  note           TEXT,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT application_events_type_check CHECK (event_type IN (
    'MATCH_CREATED','USER_INTERESTED','DRAFTING_STARTED',
    'CV_TAILORED','COVER_LETTER_DRAFTED','APPROVED',
    'APPLIED','INTERVIEW_INVITED','ASSESSMENT_SENT',
    'OFFER_RECEIVED','REJECTED','WITHDRAWN','NOTE_ADDED'
  ))
);

CREATE INDEX IF NOT EXISTS idx_application_events_app
  ON application_events (application_id, created_at DESC);

ALTER TABLE application_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS application_events_tenant ON application_events;
CREATE POLICY application_events_tenant ON application_events
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT ON application_events TO fen_app;

-- ── resumes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resumes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  application_id UUID        REFERENCES applications(id)           ON DELETE SET NULL,
  profile_id     UUID        NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  content        TEXT        NOT NULL,
  format         TEXT        NOT NULL DEFAULT 'text',
  file_key       TEXT,
  version        INTEGER     NOT NULL DEFAULT 1,
  is_base        BOOLEAN     NOT NULL DEFAULT false,  -- true = master CV, not job-specific
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_resumes_application
  ON resumes (application_id);

CREATE INDEX IF NOT EXISTS idx_resumes_profile_base
  ON resumes (profile_id, is_base);

ALTER TABLE resumes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS resumes_tenant ON resumes;
CREATE POLICY resumes_tenant ON resumes
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON resumes TO fen_app;

-- ── cover_letters ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cover_letters (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  application_id UUID        NOT NULL REFERENCES applications(id)  ON DELETE CASCADE,
  content        TEXT        NOT NULL,
  version        INTEGER     NOT NULL DEFAULT 1,
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cover_letters_application
  ON cover_letters (application_id);

ALTER TABLE cover_letters ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cover_letters_tenant ON cover_letters;
CREATE POLICY cover_letters_tenant ON cover_letters
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON cover_letters TO fen_app;

-- ── email_connections ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_connections (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email_address   TEXT        NOT NULL,
  provider        TEXT        NOT NULL DEFAULT 'gmail',
  connection_type TEXT        NOT NULL DEFAULT 'dedicated',
  oauth_tokens    JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'connected',
  scopes          TEXT[]      NOT NULL DEFAULT '{}',
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,

  CONSTRAINT email_connections_type_check CHECK (
    connection_type IN ('dedicated', 'existing')
  ),
  CONSTRAINT email_connections_status_check CHECK (
    status IN ('connected', 'disconnected', 'error')
  ),
  CONSTRAINT email_connections_tenant_email UNIQUE (tenant_id, email_address)
);

ALTER TABLE email_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_connections_tenant ON email_connections;
CREATE POLICY email_connections_tenant ON email_connections
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON email_connections TO fen_app;

-- ── email_events ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS email_events (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  application_id      UUID        REFERENCES applications(id)           ON DELETE SET NULL,
  email_connection_id UUID        REFERENCES email_connections(id)      ON DELETE SET NULL,
  kind                TEXT        NOT NULL DEFAULT 'other',
  subject             TEXT,
  snippet             TEXT,
  from_email          TEXT,
  gmail_message_id    TEXT,
  received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  notified_telegram   BOOLEAN     NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT email_events_kind_check CHECK (kind IN (
    'interview_invite','rejection','offer','assessment',
    'recruiter_reply','follow_up','other'
  ))
);

CREATE INDEX IF NOT EXISTS idx_email_events_tenant_app
  ON email_events (tenant_id, application_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_email_events_unnotified
  ON email_events (tenant_id, received_at DESC)
  WHERE notified_telegram = false;

ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS email_events_tenant ON email_events;
CREATE POLICY email_events_tenant ON email_events
  USING (tenant_id::text = current_setting('app.current_tenant', true));
GRANT SELECT, INSERT, UPDATE ON email_events TO fen_app;

-- ── FK back-references (added after table creation) ──────────────────────────
ALTER TABLE applications
  ADD CONSTRAINT fk_tailored_cv
    FOREIGN KEY (tailored_cv_id) REFERENCES resumes(id) ON DELETE SET NULL;

ALTER TABLE applications
  ADD CONSTRAINT fk_cover_letter
    FOREIGN KEY (cover_letter_id) REFERENCES cover_letters(id) ON DELETE SET NULL;
