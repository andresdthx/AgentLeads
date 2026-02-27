-- Migration 034: Split catalog_url into consult_catalog_url and show_catalog_url
--
-- consult_catalog_url: URL the agent queries to search for products (WooCommerce, Shopify, etc.)
-- show_catalog_url:    URL shown to the lead when they ask for the catalog (e.g. Canva, tienda principal)
--
-- The original catalog_url is preserved for backwards compatibility and migrated to both new columns.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS consult_catalog_url TEXT,
  ADD COLUMN IF NOT EXISTS show_catalog_url TEXT;

-- Migrate existing catalog_url data to both new columns
UPDATE clients
SET
  consult_catalog_url = catalog_url,
  show_catalog_url    = catalog_url
WHERE catalog_url IS NOT NULL;

COMMENT ON COLUMN clients.consult_catalog_url IS 'URL the agent queries to search products (WooCommerce /?s=, Shopify /search/suggest.json, etc.)';
COMMENT ON COLUMN clients.show_catalog_url    IS 'URL shown to the lead when they ask for the catalog (Canva, main store page, etc.)';

-- Verification
SELECT id, name, catalog_url, consult_catalog_url, show_catalog_url
FROM clients
ORDER BY name;
