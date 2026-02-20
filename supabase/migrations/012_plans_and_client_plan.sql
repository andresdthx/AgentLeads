-- =============================================================================
-- Migration 012: Plans — Planes de precios con LLM asignado
-- =============================================================================
-- Crea la tabla plans vinculada a llm_models y agrega plan_id a clients.
-- Planes: basico → gpt-4o-mini | pro → gpt-4o | max → o3
-- =============================================================================

-- ---------------------------------------------------------------------------
-- TABLA: plans
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS plans (
  id           UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT          NOT NULL UNIQUE,    -- 'basico', 'pro', 'max'
  display_name TEXT          NOT NULL,           -- 'Plan Básico', etc.
  llm_model_id UUID          NOT NULL REFERENCES llm_models(id),
  price_usd    NUMERIC(10,2) NOT NULL DEFAULT 0,
  is_active    BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE plans IS 'Planes de precios: cada plan define el modelo LLM que usa el cliente';

-- ---------------------------------------------------------------------------
-- AGREGAR plan_id A clients
-- ---------------------------------------------------------------------------

ALTER TABLE clients ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES plans(id);

-- ---------------------------------------------------------------------------
-- SEED: 3 planes
-- ---------------------------------------------------------------------------

INSERT INTO plans (name, display_name, llm_model_id, price_usd)
SELECT 'basico', 'Plan Básico', m.id, 29.00
FROM llm_models m
JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id = 'gpt-4o-mini'
ON CONFLICT (name) DO NOTHING;

INSERT INTO plans (name, display_name, llm_model_id, price_usd)
SELECT 'pro', 'Plan Pro', m.id, 99.00
FROM llm_models m
JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id = 'gpt-4o'
ON CONFLICT (name) DO NOTHING;

INSERT INTO plans (name, display_name, llm_model_id, price_usd)
SELECT 'max', 'Plan Max', m.id, 249.00
FROM llm_models m
JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id = 'o3'
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- ASIGNAR plan básico a clientes existentes sin plan
-- ---------------------------------------------------------------------------

UPDATE clients
SET plan_id = (SELECT id FROM plans WHERE name = 'basico')
WHERE plan_id IS NULL;
