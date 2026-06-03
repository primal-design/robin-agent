-- Phase 9: User reminders
-- Allows Fen to schedule one-shot reminders from conversation ("remind me Friday 9am")

CREATE TABLE IF NOT EXISTS reminders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id)       ON DELETE CASCADE,
  conversation_id UUID        NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  chat_id         BIGINT      NOT NULL,
  channel_id      UUID        REFERENCES worker_channels(id)        ON DELETE SET NULL,
  message         TEXT        NOT NULL,
  remind_at       TIMESTAMPTZ NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT reminders_status_check
    CHECK (status IN ('pending', 'dispatched', 'sent', 'cancelled', 'failed'))
);

CREATE INDEX IF NOT EXISTS reminders_due_idx
  ON reminders (remind_at) WHERE status = 'pending';

ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;

CREATE POLICY reminders_tenant ON reminders
  USING (tenant_id = current_setting('app.current_tenant')::uuid);

GRANT SELECT, INSERT, UPDATE ON reminders TO fen_app;

-- Register the create_reminder tool
INSERT INTO tools (id, name, description, side_effect, personal_data, reversibility, default_approval)
VALUES (
  'create_reminder',
  'Create Reminder',
  'Schedule a one-off reminder for the user at a specific date and time. Use this whenever the user asks to be reminded about something. The remind_at field must be a full ISO 8601 datetime string (e.g. 2026-06-05T09:00:00).',
  'none',
  false,
  'reversible',
  'auto'
) ON CONFLICT (id) DO NOTHING;

-- Enable for default worker
INSERT INTO worker_tools (worker_id, tool_id, enabled)
SELECT id, 'create_reminder', true
FROM workers
WHERE id = '00000000-0000-0000-0000-000000000002'
ON CONFLICT (worker_id, tool_id) DO UPDATE SET enabled = true;
