-- FEN Platform v1 — full schema
-- Run once against your Neon/Postgres database

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Core identity tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tenants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type       TEXT CHECK (type IN ('builder', 'client', 'agency')),
  name       TEXT NOT NULL,
  plan       TEXT DEFAULT 'starter',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT UNIQUE,
  phone_e164 TEXT UNIQUE,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  role      TEXT CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  PRIMARY KEY (user_id, tenant_id)
);

-- ── Worker manifest ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS workers (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  manifest   JSONB NOT NULL,
  status     TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'testing', 'live', 'paused')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Conversations & messages ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,
  worker_id        UUID REFERENCES workers(id),
  external_user_id TEXT NOT NULL,
  channel          TEXT DEFAULT 'telegram',
  state            JSONB DEFAULT '{}',
  created_at       TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tenant_id, worker_id, external_user_id, channel)
);

CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  direction       TEXT CHECK (direction IN ('inbound', 'outbound')),
  content         TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ── Business memory ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_memory (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  key       TEXT NOT NULL,
  value     TEXT NOT NULL,
  UNIQUE (tenant_id, key)
);

-- ── Approval inbox ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS approvals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID REFERENCES tenants(id) ON DELETE CASCADE,
  worker_id        UUID REFERENCES workers(id),
  conversation_id  UUID REFERENCES conversations(id),
  action_type      TEXT NOT NULL,
  action_payload   JSONB NOT NULL,
  proposed_message TEXT,
  status           TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at       TIMESTAMPTZ DEFAULT now()
);

-- ── Billing ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_customer_id     TEXT,
  stripe_subscription_id TEXT,
  plan                   TEXT DEFAULT 'starter',
  status                 TEXT,
  created_at             TIMESTAMPTZ DEFAULT now()
);

-- ── Audit log ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id),
  actor      TEXT,
  action     TEXT NOT NULL,
  target     TEXT,
  metadata   JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Waitlist (keep existing) ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS waitlist (
  id         SERIAL PRIMARY KEY,
  phone      TEXT UNIQUE,
  name       TEXT,
  role       TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ── Row Level Security ────────────────────────────────────────────────────

ALTER TABLE workers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations   ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals       ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_workers         ON workers;
DROP POLICY IF EXISTS tenant_conversations   ON conversations;
DROP POLICY IF EXISTS tenant_messages        ON messages;
DROP POLICY IF EXISTS tenant_memory          ON business_memory;
DROP POLICY IF EXISTS tenant_approvals       ON approvals;
DROP POLICY IF EXISTS tenant_subscriptions   ON subscriptions;
DROP POLICY IF EXISTS tenant_audit           ON audit_log;

CREATE POLICY tenant_workers       ON workers         USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_conversations ON conversations   USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_messages      ON messages        USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_memory        ON business_memory USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_approvals     ON approvals       USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_subscriptions ON subscriptions   USING (tenant_id = current_setting('app.current_tenant')::uuid);
CREATE POLICY tenant_audit         ON audit_log       USING (tenant_id = current_setting('app.current_tenant')::uuid);
