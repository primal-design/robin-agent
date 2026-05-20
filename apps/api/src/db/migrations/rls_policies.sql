-- RLS policies for all tenant-scoped tables.
-- Run this after creating the tables. The app_tenant_id setting is injected
-- by the withTenant() wrapper before every pooled query.
--
-- Pattern: every tenant-scoped table gets RLS enabled + a SELECT/INSERT/UPDATE/DELETE
-- policy that checks app.tenant_id = tenant_id. Queries that don't set this
-- GUC will see no rows (fail-closed), which is the safe default.

-- ── workers ───────────────────────────────────────────────────────────────────
ALTER TABLE workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE workers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS workers_tenant_isolation ON workers;
CREATE POLICY workers_tenant_isolation ON workers
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── business_memory ───────────────────────────────────────────────────────────
ALTER TABLE business_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_memory_tenant_isolation ON business_memory;
CREATE POLICY business_memory_tenant_isolation ON business_memory
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── conversations ─────────────────────────────────────────────────────────────
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_tenant_isolation ON conversations;
CREATE POLICY conversations_tenant_isolation ON conversations
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── messages ──────────────────────────────────────────────────────────────────
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS messages_tenant_isolation ON messages;
CREATE POLICY messages_tenant_isolation ON messages
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── approvals ─────────────────────────────────────────────────────────────────
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS approvals_tenant_isolation ON approvals;
CREATE POLICY approvals_tenant_isolation ON approvals
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── prompt_history ────────────────────────────────────────────────────────────
ALTER TABLE prompt_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS prompt_history_tenant_isolation ON prompt_history;
CREATE POLICY prompt_history_tenant_isolation ON prompt_history
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── audit_log ─────────────────────────────────────────────────────────────────
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_log_tenant_isolation ON audit_log;
CREATE POLICY audit_log_tenant_isolation ON audit_log
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ── Cross-tenant regression test (run manually or in CI) ─────────────────────
-- SET app.tenant_id = '<tenant_a_uuid>';
-- SELECT COUNT(*) FROM business_memory; -- should return only tenant A rows
-- SET app.tenant_id = '<tenant_b_uuid>';
-- SELECT COUNT(*) FROM business_memory; -- should return only tenant B rows
-- RESET app.tenant_id;
-- SELECT COUNT(*) FROM business_memory; -- should return 0 (fail-closed)
