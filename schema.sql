$(cat schema.sql)

-- Added tables
CREATE TABLE IF NOT EXISTS waitlist (
  request_id TEXT PRIMARY KEY,
  name TEXT,
  phone TEXT UNIQUE,
  role TEXT,
  cracks TEXT,
  note TEXT,
  status TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT,
  code TEXT,
  used BOOLEAN DEFAULT FALSE,
  expires_at TIMESTAMPTZ DEFAULT now() + interval '10 minutes'
);

CREATE TABLE IF NOT EXISTS gmail_tokens (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  expiry_date BIGINT
);
