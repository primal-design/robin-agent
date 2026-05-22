-- Phase 5E: Add HubSpot to connector provider constraint
-- Must drop and recreate the CHECK constraint to add the new value

ALTER TABLE tenant_data_source_grants
  DROP CONSTRAINT IF EXISTS tenant_data_source_grants_provider_check;

ALTER TABLE tenant_data_source_grants
  ADD CONSTRAINT tenant_data_source_grants_provider_check
  CHECK (provider IN ('gmail', 'gdrive', 'slack', 'hubspot'));
