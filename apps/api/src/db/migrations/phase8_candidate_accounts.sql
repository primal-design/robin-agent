-- Phase 8: Per-candidate accounts
-- Each candidate gets their own tenant, profile, and Telegram connection

-- Ensure tenants has email column (from phase7, but safe to re-run)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_email_unique ON tenants (LOWER(email)) WHERE email IS NOT NULL;

-- Connect tokens: used to link a Telegram chat to a tenant
CREATE TABLE IF NOT EXISTS telegram_connect_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  used        BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours')
);
CREATE INDEX IF NOT EXISTS tct_token_idx ON telegram_connect_tokens (token) WHERE NOT used;
CREATE INDEX IF NOT EXISTS tct_tenant_idx ON telegram_connect_tokens (tenant_id);

-- Disable RLS on new table
ALTER TABLE telegram_connect_tokens DISABLE ROW LEVEL SECURITY;
