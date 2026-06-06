-- Phase 11: Scheduler cross-tenant fixes
-- Fix RLS policies that error when app.current_tenant is not set.
-- Add SECURITY DEFINER functions for cross-tenant scheduler reads.

-- ── Fix reminders RLS ─────────────────────────────────────────────────────────
-- Use missing_ok (second arg = true) so unset GUC returns '' not an error.
-- UUID can never equal '', so no rows leak when tenant context is absent.
DROP POLICY IF EXISTS reminders_tenant ON reminders;
CREATE POLICY reminders_tenant ON reminders
  USING (tenant_id::text = current_setting('app.current_tenant', true));

-- ── get_due_reminders() ───────────────────────────────────────────────────────
-- SECURITY DEFINER: runs as table owner, bypasses RLS.
-- Called by the scheduler to read across all tenants.
CREATE OR REPLACE FUNCTION get_due_reminders(p_limit INTEGER DEFAULT 200)
RETURNS TABLE (
  id              UUID,
  tenant_id       UUID,
  conversation_id UUID,
  chat_id         BIGINT,
  channel_id      UUID,
  message         TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT id, tenant_id, conversation_id, chat_id, channel_id, message
  FROM reminders
  WHERE status = 'pending'
    AND remind_at <= now()
  ORDER BY remind_at ASC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION get_due_reminders(INTEGER) TO fen_app;
