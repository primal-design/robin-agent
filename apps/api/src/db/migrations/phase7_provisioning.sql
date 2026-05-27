-- Phase 7: Client provisioning support
-- Run against Neon after phase6_email_first.sql

-- Add email + stripe_customer_id to tenants
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS provisioned_at TIMESTAMPTZ DEFAULT now();

-- Email lookup index for tenants
CREATE INDEX IF NOT EXISTS tenants_email_idx ON tenants (LOWER(email)) WHERE email IS NOT NULL;

-- Add email column to users if missing (should already exist from migrations.sql)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_idx ON users (LOWER(email)) WHERE email IS NOT NULL;

-- Track per-tenant job usage for billing metering
CREATE TABLE IF NOT EXISTS usage_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  quantity   INTEGER DEFAULT 1,
  metadata   JSONB,
  recorded_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_events_tenant_ts ON usage_events (tenant_id, recorded_at DESC);
