-- Migration 045: Add intent context fields to clients table
-- Adds per-client configuration for keyword pre-filter, brand/category normalization,
-- and business description for the intent agent prompt interpolation.
-- All fields are additive (non-breaking) with safe defaults.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS keywords            JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS brands              JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS categories          JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS business_description TEXT DEFAULT NULL;

-- GIN indexes for future JSONB queries
CREATE INDEX IF NOT EXISTS idx_clients_keywords   ON clients USING gin(keywords);
CREATE INDEX IF NOT EXISTS idx_clients_brands     ON clients USING gin(brands);
CREATE INDEX IF NOT EXISTS idx_clients_categories ON clients USING gin(categories);

-- Backfill business_description from name + business_type for existing clients
-- so the intent prompt always has a meaningful description even without explicit config.
UPDATE clients
SET business_description = COALESCE(
  business_description,
  CASE
    WHEN business_type IS NOT NULL THEN name || ' — ' || business_type
    ELSE name
  END
)
WHERE business_description IS NULL;

COMMENT ON COLUMN clients.keywords IS
  'Array of keywords (JSONB string[]) used as per-client override for the product intent pre-filter. Falls back to the global regex when empty.';

COMMENT ON COLUMN clients.brands IS
  'Array of brand names (JSONB string[]) injected into {{brands}} placeholder of the intent agent prompt for normalisation.';

COMMENT ON COLUMN clients.categories IS
  'Array of product/service categories (JSONB string[]) injected into {{categories}} placeholder of the intent agent prompt.';

COMMENT ON COLUMN clients.business_description IS
  'Short description of the business injected into {{business_description}} placeholder of the intent agent prompt. Auto-populated from name + business_type if not set explicitly.';
