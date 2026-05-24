-- Phase 6: Email-first identity
-- Phone is no longer required; email becomes the primary waitlist identifier.

-- Make phone nullable in waitlist
ALTER TABLE waitlist ALTER COLUMN phone DROP NOT NULL;

-- Ensure email column exists
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS email TEXT;

-- Unique index on email (case-insensitive via lower())
DROP INDEX IF EXISTS waitlist_email_unique_idx;
CREATE UNIQUE INDEX waitlist_email_unique_idx ON waitlist (LOWER(email)) WHERE email IS NOT NULL;

-- Ensure submitted_at / created_at column exists (older schemas may use created_at only)
ALTER TABLE waitlist ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ DEFAULT now();
UPDATE waitlist SET submitted_at = created_at WHERE submitted_at IS NULL AND created_at IS NOT NULL;
