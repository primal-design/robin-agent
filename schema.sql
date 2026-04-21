CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE channel_type AS ENUM ('whatsapp', 'telegram', 'sms', 'webchat');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_kind AS ENUM ('text', 'interactive', 'image', 'document', 'audio', 'system');
CREATE TYPE action_status AS ENUM ('planned', 'awaiting_approval', 'approved', 'running', 'done', 'failed', 'cancelled', 'expired');
CREATE TYPE approval_status AS ENUM ('pending', 'approved', 'rejected', 'expired');
CREATE TYPE commitment_status AS ENUM ('open', 'done', 'overdue', 'cancelled');
CREATE TYPE deal_stage AS ENUM ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost');
CREATE TYPE risk_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE memory_scope AS ENUM ('profile', 'contact', 'pattern', 'preference', 'relationship', 'operational');
CREATE TYPE trust_event_type AS ENUM ('oauth_connected', 'oauth_disconnected', 'approval_granted', 'approval_rejected', 'manual_pause', 'manual_resume', 'data_export', 'data_erasure', 'policy_acknowledged');
CREATE TYPE audit_event_type AS ENUM ('created', 'updated', 'approved', 'executed', 'failed', 'deleted', 'exported');

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 TEXT NOT NULL UNIQUE,
  email TEXT,
  name TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/London',
  status TEXT NOT NULL DEFAULT 'active',
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_identities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel channel_type NOT NULL,
  external_user_id TEXT NOT NULL,
  external_phone_number_id TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel, external_user_id)
);

CREATE TABLE onboarding_states (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  has_forwarded_emails BOOLEAN NOT NULL DEFAULT FALSE,
  has_top_clients BOOLEAN NOT NULL DEFAULT FALSE,
  has_weekly_goal BOOLEAN NOT NULL DEFAULT FALSE,
  weekly_goal TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel channel_type NOT NULL,
  state_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_message_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel)
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  channel channel_type NOT NULL,
  external_message_id TEXT,
  direction message_direction NOT NULL,
  kind message_kind NOT NULL DEFAULT 'text',
  body TEXT,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'accepted',
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(channel, external_message_id)
);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  company TEXT,
  email TEXT,
  phone TEXT,
  relationship_stage TEXT,
  notes TEXT,
  is_top_priority BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE voice_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  source_contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  tone_summary TEXT NOT NULL,
  style_markers JSONB NOT NULL DEFAULT '[]'::jsonb,
  sample_count INT NOT NULL DEFAULT 0,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  value_minor BIGINT,
  currency TEXT NOT NULL DEFAULT 'GBP',
  stage deal_stage NOT NULL DEFAULT 'lead',
  risk risk_level NOT NULL DEFAULT 'low',
  is_at_risk BOOLEAN NOT NULL DEFAULT FALSE,
  days_silent INT NOT NULL DEFAULT 0,
  last_contact_at TIMESTAMPTZ,
  next_step TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE commitments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
  deal_id UUID REFERENCES deals(id) ON DELETE SET NULL,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  due_at TIMESTAMPTZ,
  status commitment_status NOT NULL DEFAULT 'open',
  pressure_level INT NOT NULL DEFAULT 0,
  visibility_score INT NOT NULL DEFAULT 0,
  is_user_owned BOOLEAN NOT NULL DEFAULT TRUE,
  last_nudged_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope memory_scope NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id UUID,
  memory_key TEXT NOT NULL,
  value_json JSONB NOT NULL,
  confidence NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  source_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
  type TEXT NOT NULL,
  status action_status NOT NULL DEFAULT 'planned',
  requires_approval BOOLEAN NOT NULL DEFAULT TRUE,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  linked_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  linked_commitment_id UUID REFERENCES commitments(id) ON DELETE SET NULL,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status approval_status NOT NULL DEFAULT 'pending',
  requested_via channel_type NOT NULL,
  request_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  response_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ
);

CREATE TABLE visible_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id UUID NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trust_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type trust_event_type NOT NULL,
  score_delta INT NOT NULL DEFAULT 0,
  details_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE trust_scores (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  current_score INT NOT NULL DEFAULT 0,
  last_reviewed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action_id UUID REFERENCES actions(id) ON DELETE SET NULL,
  event_type audit_event_type NOT NULL,
  actor TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE scheduled_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  run_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'queued',
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation_created_at ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_commitments_user_status_due_at ON commitments(user_id, status, due_at);
CREATE INDEX idx_actions_user_status ON actions(user_id, status);
CREATE INDEX idx_scheduled_jobs_run_at_status ON scheduled_jobs(run_at, status);
CREATE INDEX idx_memories_user_scope_key ON memories(user_id, scope, memory_key);
CREATE INDEX idx_deals_user_risk_stage ON deals(user_id, risk, stage);
