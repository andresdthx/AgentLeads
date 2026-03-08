-- Migration 042: Drop deprecated columns from clients
--
-- Removes columns that were soft-deprecated across multiple migrations:
--   - llm_model:      superseded by plans → llm_models join (migration 020+)
--   - llm_temperature: replaced by constant DEFAULT_LLM_TEMPERATURE in client.ts
--   - product_mode:   superseded by capabilities JSONB (migration 040)
--   - catalog_url:    split into consult_catalog_url / show_catalog_url (migration 034)
--
-- All TypeScript references to these columns have been removed in the same commit.

ALTER TABLE clients
  DROP COLUMN IF EXISTS llm_model,
  DROP COLUMN IF EXISTS llm_temperature,
  DROP COLUMN IF EXISTS product_mode,
  DROP COLUMN IF EXISTS catalog_url;
