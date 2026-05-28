-- Phase 8: Multi-tenant channel registry
-- Supports one-bot-per-client Telegram and future channels (WhatsApp, Discord, email)

-- ── worker_channels ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS worker_channels (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)  ON DELETE CASCADE,
  worker_id       UUID        NOT NULL REFERENCES workers(id)  ON DELETE CASCADE,
  channel_type    TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active',
  external_id     TEXT,                        -- bot username, phone number, etc.
  display_name    TEXT,
  encrypted_config JSONB      NOT NULL DEFAULT '{}',   -- bot_token, webhook_secret (encrypted)
  public_config   JSONB       NOT NULL DEFAULT '{}',   -- bot_username, mode, etc.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT worker_channels_channel_type_check
    CHECK (channel_type IN ('telegram', 'web', 'discord', 'email', 'whatsapp')),
  CONSTRAINT worker_channels_status_check
    CHECK (status IN ('active', 'paused', 'disabled', 'error'))
);

CREATE INDEX IF NOT EXISTS idx_wch_worker   ON worker_channels (worker_id);
CREATE INDEX IF NOT EXISTS idx_wch_tenant   ON worker_channels (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wch_type     ON worker_channels (channel_type, status);

-- ── Add channel_id to conversations (nullable — existing rows keep NULL) ───────

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES worker_channels(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_unique_channel_user
  ON conversations (channel_id, external_user_id)
  WHERE channel_id IS NOT NULL;

-- ── RLS ────────────────────────────────────────────────────────────────────────

ALTER TABLE worker_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_channels FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wch_tenant_isolation ON worker_channels;
CREATE POLICY wch_tenant_isolation ON worker_channels
  USING      (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid);

-- ── Grants ────────────────────────────────────────────────────────────────────

GRANT SELECT, INSERT, UPDATE, DELETE ON worker_channels TO fen_app;
