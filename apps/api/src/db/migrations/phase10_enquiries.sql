-- Phase 10: Enquiry management foundation
-- UK trades ICP: plumbers, electricians, builders, cleaners
-- Tables: customers, enquiries, enquiry_events, inbound_sources,
--         quotes, quote_line_items, appointments, llm_calls

-- ── customers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name             TEXT,
  email            TEXT,
  email_normalized TEXT,
  phone            TEXT,
  phone_normalized TEXT,
  postcode         TEXT,
  lifetime_value   NUMERIC     NOT NULL DEFAULT 0,
  first_enquiry_at TIMESTAMPTZ,
  last_enquiry_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No hard unique constraint — missing/shared numbers are common in trades
-- Matching is surfaced to owner, never auto-enforced
CREATE INDEX IF NOT EXISTS idx_customers_tenant_email
  ON customers (tenant_id, email_normalized)
  WHERE email_normalized IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_customers_tenant_phone
  ON customers (tenant_id, phone_normalized)
  WHERE phone_normalized IS NOT NULL;

ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS customers_tenant ON customers;
CREATE POLICY customers_tenant ON customers
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT, UPDATE ON customers TO fen_app;

-- ── enquiries ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enquiries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID        NOT NULL REFERENCES tenants(id)    ON DELETE CASCADE,
  worker_id        UUID        NOT NULL REFERENCES workers(id)    ON DELETE CASCADE,
  customer_id      UUID        NOT NULL REFERENCES customers(id)  ON DELETE RESTRICT,

  source_type      TEXT        NOT NULL DEFAULT 'unknown',

  telegram_chat_id TEXT,
  customer_name    TEXT,
  customer_contact TEXT,
  customer_postcode TEXT,
  enquiry_text     TEXT        NOT NULL,
  summary          TEXT,
  missing_details  JSONB       NOT NULL DEFAULT '[]',

  service_area_match BOOLEAN,
  fit_score          INTEGER,
  urgency_score      INTEGER,
  value_score        INTEGER,
  lead_score         INTEGER,

  status           TEXT        NOT NULL DEFAULT 'new',
  urgency          TEXT        NOT NULL DEFAULT 'normal',
  next_action      TEXT,
  due_at           TIMESTAMPTZ,
  draft_reply      TEXT,
  last_reminded_at TIMESTAMPTZ,
  handled_at       TIMESTAMPTZ,
  outcome          TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT enquiries_source_type_check CHECK (source_type IN (
    'telegram_manual', 'email', 'website_form', 'missed_call',
    'checkatrade', 'bark', 'mybuilder', 'google_ads',
    'organic', 'referral', 'unknown'
  )),
  CONSTRAINT enquiries_status_check CHECK (status IN (
    'new', 'draft_ready', 'waiting', 'replied', 'qualified',
    'survey_booked', 'quoted', 'job_booked', 'won',
    'lost', 'handled', 'spam', 'closed'
  )),
  CONSTRAINT enquiries_urgency_check CHECK (urgency IN ('normal', 'high'))
);

CREATE INDEX IF NOT EXISTS idx_enquiries_tenant_status
  ON enquiries (tenant_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_enquiries_tenant_lead_score
  ON enquiries (tenant_id, lead_score DESC)
  WHERE status NOT IN ('won', 'lost', 'spam', 'closed');

CREATE INDEX IF NOT EXISTS idx_enquiries_customer
  ON enquiries (customer_id);

ALTER TABLE enquiries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enquiries_tenant ON enquiries;
CREATE POLICY enquiries_tenant ON enquiries
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT, UPDATE ON enquiries TO fen_app;

-- ── enquiry_events ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS enquiry_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id  UUID        NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  event_type  TEXT        NOT NULL,
  actor       TEXT        NOT NULL DEFAULT 'system',
  payload     JSONB       NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT enquiry_events_event_type_check CHECK (event_type IN (
    'ENQUIRY_CREATED', 'DRAFT_GENERATED', 'ALERT_SENT',
    'REPLY_SENT', 'STATUS_CHANGED', 'SCORE_ASSIGNED',
    'QUOTE_CREATED', 'QUOTE_SENT', 'QUOTE_ACCEPTED',
    'APPOINTMENT_BOOKED', 'JOB_BOOKED', 'WON', 'LOST',
    'CUSTOMER_MATCH_SUGGESTED', 'CUSTOMER_MERGED'
  )),
  CONSTRAINT enquiry_events_actor_check CHECK (actor IN ('system', 'owner', 'customer'))
);

CREATE INDEX IF NOT EXISTS idx_enquiry_events_enquiry
  ON enquiry_events (enquiry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_enquiry_events_tenant_type
  ON enquiry_events (tenant_id, event_type, created_at DESC);

ALTER TABLE enquiry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS enquiry_events_tenant ON enquiry_events;
CREATE POLICY enquiry_events_tenant ON enquiry_events
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT ON enquiry_events TO fen_app;

-- ── inbound_sources ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inbound_sources (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id       UUID        NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  tenant_id        UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  channel_type     TEXT        NOT NULL,
  external_id      TEXT,
  raw_payload      JSONB       NOT NULL DEFAULT '{}',
  parse_confidence NUMERIC,
  metadata         JSONB       NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE inbound_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbound_sources_tenant ON inbound_sources;
CREATE POLICY inbound_sources_tenant ON inbound_sources
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT ON inbound_sources TO fen_app;

-- ── quotes ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  enquiry_id  UUID        NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  customer_id UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  status      TEXT        NOT NULL DEFAULT 'draft',
  total       NUMERIC,
  currency    TEXT        NOT NULL DEFAULT 'GBP',
  valid_until TIMESTAMPTZ,
  sent_at     TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT quotes_status_check CHECK (status IN (
    'draft', 'sent', 'accepted', 'declined', 'expired'
  ))
);

CREATE INDEX IF NOT EXISTS idx_quotes_enquiry
  ON quotes (enquiry_id);

CREATE INDEX IF NOT EXISTS idx_quotes_tenant_status
  ON quotes (tenant_id, status, valid_until);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quotes_tenant ON quotes;
CREATE POLICY quotes_tenant ON quotes
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT, UPDATE ON quotes TO fen_app;

-- ── quote_line_items ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quote_line_items (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    UUID    NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  tenant_id   UUID    NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  description TEXT    NOT NULL,
  qty         NUMERIC NOT NULL DEFAULT 1,
  unit_price  NUMERIC NOT NULL,
  subtotal    NUMERIC GENERATED ALWAYS AS (qty * unit_price) STORED,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE quote_line_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quote_line_items_tenant ON quote_line_items;
CREATE POLICY quote_line_items_tenant ON quote_line_items
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON quote_line_items TO fen_app;

-- ── appointments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES tenants(id)   ON DELETE CASCADE,
  enquiry_id   UUID        NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  customer_id  UUID        NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  type         TEXT        NOT NULL DEFAULT 'survey',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'booked',
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT appointments_type_check   CHECK (type   IN ('survey', 'job_visit', 'call')),
  CONSTRAINT appointments_status_check CHECK (status IN ('booked', 'confirmed', 'completed', 'cancelled'))
);

CREATE INDEX IF NOT EXISTS idx_appointments_tenant_scheduled
  ON appointments (tenant_id, scheduled_at)
  WHERE status IN ('booked', 'confirmed');

ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS appointments_tenant ON appointments;
CREATE POLICY appointments_tenant ON appointments
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT, UPDATE ON appointments TO fen_app;

-- ── llm_calls ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_calls (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purpose       TEXT        NOT NULL DEFAULT 'other',
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      NUMERIC,
  duration_ms   INTEGER,
  input         TEXT,
  output        TEXT,
  success       BOOLEAN     NOT NULL DEFAULT true,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT llm_calls_purpose_check CHECK (purpose IN (
    'extraction', 'draft_reply', 'scoring', 'summary', 'other'
  ))
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_tenant_purpose
  ON llm_calls (tenant_id, purpose, created_at DESC);

ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS llm_calls_tenant ON llm_calls;
CREATE POLICY llm_calls_tenant ON llm_calls
  USING (tenant_id = current_setting('app.current_tenant')::uuid);
GRANT SELECT, INSERT ON llm_calls TO fen_app;
