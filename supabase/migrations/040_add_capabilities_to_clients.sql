-- Migration 040: Add capabilities JSONB to clients table
-- Replaces the binary product_mode enum with a flexible feature-flag object
-- that supports mixed clients (catalog + inventory + faqs + services, etc.)
-- product_mode is kept for backwards compatibility and soft-deprecated.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS capabilities JSONB;

-- Backfill from existing product_mode for all current clients
UPDATE clients
SET capabilities = jsonb_build_object(
  'catalog',   (product_mode = 'catalog'),
  'inventory', (product_mode = 'inventory'),
  'faqs',      false
)
WHERE capabilities IS NULL;

COMMENT ON COLUMN clients.capabilities IS
  'Feature flags per client: { catalog: bool, inventory: bool, faqs: bool }.
   Replaces product_mode for multi-niche support.
   Code falls back to product_mode when null (backwards compat).';

-- Verification
SELECT id, name, product_mode, capabilities FROM clients ORDER BY name;
