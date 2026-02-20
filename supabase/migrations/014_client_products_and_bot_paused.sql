-- =============================================================================
-- Migration 014: Inventario por cliente + estado bot_paused en leads
-- =============================================================================

-- ---------------------------------------------------------------------------
-- COLUMNAS bot_paused en leads
-- ---------------------------------------------------------------------------

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS bot_paused        BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bot_paused_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bot_paused_reason TEXT;       -- 'no_catalog' | 'out_of_stock' | 'needs_images' | 'transferred'

COMMENT ON COLUMN leads.bot_paused        IS 'TRUE = el agente no responde, humano en control';
COMMENT ON COLUMN leads.bot_paused_at     IS 'Cuándo fue pausado por última vez';
COMMENT ON COLUMN leads.bot_paused_reason IS 'Motivo de la pausa para trazabilidad';

-- ---------------------------------------------------------------------------
-- TABLA: client_products
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS client_products (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID          NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name            TEXT          NOT NULL,           -- "Air Force 1 Blancas Triple AAA"
  brand           TEXT,                             -- "Nike"
  model           TEXT,                             -- "Air Force 1"
  category        TEXT,                             -- "sneakers" | "ropa"
  available_sizes TEXT[]        NOT NULL DEFAULT '{}', -- '{38,39,40,41,42}'
  price_retail    NUMERIC(12,2),                    -- precio detal
  price_wholesale NUMERIC(12,2),                    -- precio mayorista
  description     TEXT,                             -- info extra visible al agente
  image_urls      TEXT[]        NOT NULL DEFAULT '{}', -- URLs para que el humano envíe
  stock_status    TEXT          NOT NULL DEFAULT 'available'
                  CHECK (stock_status IN ('available', 'low_stock', 'out_of_stock')),
  is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ
);

COMMENT ON TABLE  client_products                  IS 'Catálogo de productos por cliente para el agente de inventario';
COMMENT ON COLUMN client_products.available_sizes  IS 'Array de tallas disponibles: {38,39,40,41,42}';
COMMENT ON COLUMN client_products.description      IS 'Texto adicional que el agente puede usar al responder';
COMMENT ON COLUMN client_products.image_urls       IS 'URLs de fotos del producto para que el vendedor humano envíe';

-- Índices
CREATE INDEX idx_client_products_client     ON client_products(client_id, is_active);
CREATE INDEX idx_client_products_brand      ON client_products USING gin(to_tsvector('simple', coalesce(brand,'') || ' ' || coalesce(model,'')));
CREATE INDEX idx_client_products_sizes      ON client_products USING gin(available_sizes);
CREATE INDEX idx_leads_bot_paused           ON leads(bot_paused) WHERE bot_paused = TRUE;

-- Trigger updated_at
CREATE TRIGGER update_client_products_updated_at
  BEFORE UPDATE ON client_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE client_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access to client_products"
  ON client_products FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON client_products TO service_role;

-- ---------------------------------------------------------------------------
-- SEED: productos de ejemplo para Bunny Shoes
-- ---------------------------------------------------------------------------

DO $$
DECLARE
  v_client_id UUID;
BEGIN
  -- Buscar cliente de zapatos por nombre
  SELECT id INTO v_client_id
  FROM clients
  WHERE name ILIKE '%bunny%' OR name ILIKE '%shoe%' OR name ILIKE '%zapato%'
  LIMIT 1;

  IF v_client_id IS NULL THEN
    RAISE NOTICE 'No se encontró cliente de zapatos, omitiendo seed de productos';
    RETURN;
  END IF;

  INSERT INTO client_products (client_id, name, brand, model, category, available_sizes, price_retail, price_wholesale, stock_status, description) VALUES

  -- Nike
  (v_client_id, 'Nike Air Force 1 Blancas AAA', 'Nike', 'Air Force 1', 'sneakers',
   ARRAY['36','37','38','39','40','41','42','43','44'], 180000, 150000, 'available',
   'Colorway blanco full, suela original, caja incluida'),

  (v_client_id, 'Nike Air Force 1 Negras AAA', 'Nike', 'Air Force 1', 'sneakers',
   ARRAY['38','39','40','41','42','43'], 180000, 150000, 'available',
   'Colorway negro full, acabado mate'),

  (v_client_id, 'Nike Air Force 1 Panda (Blanco/Negro)', 'Nike', 'Air Force 1', 'sneakers',
   ARRAY['40','41','42'], 185000, 155000, 'low_stock',
   'Últimas unidades disponibles'),

  (v_client_id, 'Nike Air Max 90 Blancas', 'Nike', 'Air Max 90', 'sneakers',
   ARRAY['38','39','40','41','42','43','44'], 195000, 165000, 'available',
   'Unidad de aire visible, muy cómodo'),

  (v_client_id, 'Nike Dunk Low Retro Blanco/Negro', 'Nike', 'Dunk Low', 'sneakers',
   ARRAY['38','39','40','41','42'], 190000, 160000, 'available', NULL),

  (v_client_id, 'Nike SB Dunk Low Pro', 'Nike', 'SB Dunk', 'sneakers',
   ARRAY['41','42','43','44'], 195000, 165000, 'out_of_stock', NULL),

  -- Adidas
  (v_client_id, 'Adidas Stan Smith Blancas', 'Adidas', 'Stan Smith', 'sneakers',
   ARRAY['36','37','38','39','40','41','42','43'], 165000, 138000, 'available',
   'Clásico atemporal, cuero sintético de calidad'),

  (v_client_id, 'Adidas Superstar Shell Toe', 'Adidas', 'Superstar', 'sneakers',
   ARRAY['38','39','40','41','42','43','44'], 170000, 142000, 'available', NULL),

  (v_client_id, 'Adidas Samba OG Blanco/Negro', 'Adidas', 'Samba', 'sneakers',
   ARRAY['39','40','41','42','43'], 175000, 148000, 'available',
   'Tendencia 2024-2025, muy solicitado'),

  -- Jordan
  (v_client_id, 'Jordan 1 Mid Blanco/Negro', 'Jordan', 'Jordan 1 Mid', 'sneakers',
   ARRAY['40','41','42','43','44'], 220000, 190000, 'available', NULL),

  (v_client_id, 'Jordan 1 Low OG', 'Jordan', 'Jordan 1 Low', 'sneakers',
   ARRAY['38','39','40','41','42'], 210000, 180000, 'available', NULL),

  -- Otras marcas
  (v_client_id, 'Puma Suede Classic', 'Puma', 'Suede Classic', 'sneakers',
   ARRAY['38','39','40','41','42','43'], 155000, 128000, 'available', NULL),

  (v_client_id, 'Vans Old Skool Negro/Blanco', 'Vans', 'Old Skool', 'sneakers',
   ARRAY['36','37','38','39','40','41','42','43','44'], 160000, 133000, 'available', NULL),

  (v_client_id, 'Vans Sk8-Hi', 'Vans', 'Sk8-Hi', 'sneakers',
   ARRAY['38','39','40','41','42','43'], 168000, 140000, 'available', NULL),

  (v_client_id, 'Converse Chuck Taylor All Star', 'Converse', 'Chuck Taylor', 'sneakers',
   ARRAY['36','37','38','39','40','41','42','43','44'], 145000, 120000, 'available', NULL)

  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Seed de productos completado para cliente ID: %', v_client_id;
END;
$$;
