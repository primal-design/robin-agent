ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS email TEXT;
CREATE INDEX IF NOT EXISTS idx_waitlist_email ON waitlist(email);
