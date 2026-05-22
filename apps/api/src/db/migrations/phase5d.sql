-- Phase 5D: Slack read-only + embedding dimension tracking

-- ── Add 'slack' to the provider constraint ────────────────────────────────────
ALTER TABLE tenant_data_source_grants
  DROP CONSTRAINT IF EXISTS tdsg_provider_check;

ALTER TABLE tenant_data_source_grants
  ADD CONSTRAINT tdsg_provider_check
    CHECK (provider IN ('gmail', 'gdrive', 'slack'));

-- ── Track embedding dimension for future model migrations ────────────────────
ALTER TABLE business_memory_search
  ADD COLUMN IF NOT EXISTS embedding_dimension INTEGER;

-- Backfill dimension for existing embeddings
UPDATE business_memory_search
SET embedding_dimension = 1024
WHERE embedding IS NOT NULL AND embedding_dimension IS NULL;

-- ── Slack bot tokens do not expire — token_expiry can be NULL ────────────────
-- No schema change needed; token_expiry is already NULLable.
-- Note: Slack tokens are stored in access_token_enc; refresh_token_enc is NULL.
