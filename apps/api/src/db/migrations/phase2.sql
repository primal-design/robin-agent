-- Phase 2: Episodic memory, tool registry, worker tool allowlist, citations

-- ── Episodic memory ───────────────────────────────────────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS summary            TEXT        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS summary_updated_at TIMESTAMPTZ DEFAULT NULL;

-- ── Tool registry ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tools (
  id               TEXT        PRIMARY KEY,
  name             TEXT        NOT NULL,
  description      TEXT        NOT NULL,
  side_effect      TEXT        NOT NULL DEFAULT 'none',
  personal_data    BOOLEAN     NOT NULL DEFAULT false,
  reversibility    TEXT        NOT NULL DEFAULT 'reversible',
  default_approval TEXT        NOT NULL DEFAULT 'auto',
  enabled          BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT tools_side_effect_check
    CHECK (side_effect IN ('none', 'external_message', 'external_write', 'external_delete', 'payment')),
  CONSTRAINT tools_reversibility_check
    CHECK (reversibility IN ('reversible', 'conditional', 'irreversible')),
  CONSTRAINT tools_approval_check
    CHECK (default_approval IN ('auto', 'notify', 'required'))
);

-- ── Worker tool allowlist ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_tools (
  worker_id UUID NOT NULL REFERENCES workers(id) ON DELETE CASCADE,
  tool_id   TEXT NOT NULL REFERENCES tools(id)   ON DELETE CASCADE,
  enabled   BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY (worker_id, tool_id)
);

-- ── Citation storage ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS citations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID        REFERENCES conversations(id) ON DELETE CASCADE,
  tool_id         TEXT,
  title           TEXT,
  url             TEXT,
  snippet         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_citations_conversation ON citations (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_citations_tenant       ON citations (tenant_id,       created_at DESC);

-- ── Seed web_search tool ──────────────────────────────────────────────────────
INSERT INTO tools (id, name, description, side_effect, personal_data, reversibility, default_approval)
VALUES (
  'web_search',
  'Web Search',
  'Search the web for current information, news, facts, prices, competitors, or any topic. Returns titles, URLs, and snippets from real web pages.',
  'none',
  false,
  'reversible',
  'auto'
) ON CONFLICT (id) DO NOTHING;
