-- Phase 5C: Google Drive connector + encryption key rotation path

-- ── Track encryption key version per row ─────────────────────────────────────
-- encryption_key_id mirrors the keyId embedded in the ciphertext payload.
-- Used to find rows that need re-encryption when rotating keys.
ALTER TABLE tenant_data_source_grants
  ADD COLUMN IF NOT EXISTS encryption_key_id TEXT NOT NULL DEFAULT '1';

-- Index for rotation queries: find all grants encrypted with a specific key version
CREATE INDEX IF NOT EXISTS idx_tdsg_key_id
  ON tenant_data_source_grants (encryption_key_id)
  WHERE status = 'connected';

-- ── Google Drive uses the same Google OAuth2 client as Gmail ─────────────────
-- The gdrive provider is already allowed by the phase5a constraint.
-- No provider constraint change needed.

-- ── Backfill encryption_key_id for any existing rows ─────────────────────────
UPDATE tenant_data_source_grants
SET encryption_key_id = '1'
WHERE encryption_key_id IS NULL;
