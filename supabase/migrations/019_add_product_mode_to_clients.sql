-- Add product_mode and catalog_url to clients table.
-- Each client operates in ONE mode: 'inventory' (structured DB products)
-- or 'catalog' (a URL link shared with the customer via the LLM).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS product_mode text NOT NULL DEFAULT 'inventory'
    CHECK (product_mode IN ('inventory', 'catalog')),
  ADD COLUMN IF NOT EXISTS catalog_url text;

COMMENT ON COLUMN clients.product_mode IS
  '''inventory'': bot queries client_products table and injects matching products into the LLM prompt.
   ''catalog'': bot injects a catalog URL into the LLM prompt; LLM shares it when the customer asks about products.';

COMMENT ON COLUMN clients.catalog_url IS
  'URL of the product catalog (PDF, Google Drive link, etc.). Required when product_mode = ''catalog''.';
