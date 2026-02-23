-- Migration 020: Add 'vision' to agent_type allowed values
-- Extends the CHECK constraint on agent_prompts.agent_type to include 'vision'.
-- Inserts the global Vision Agent prompt (client_id IS NULL, like intent).

-- ============================================================
-- 1. ACTUALIZAR CONSTRAINT agent_type
-- ============================================================

-- Drop the inline CHECK (auto-named by Postgres)
ALTER TABLE agent_prompts
  DROP CONSTRAINT IF EXISTS agent_prompts_agent_type_check;

-- Add updated CHECK including 'vision'
ALTER TABLE agent_prompts
  ADD CONSTRAINT agent_prompts_agent_type_check
    CHECK (agent_type IN ('sales', 'intent', 'vision'));

-- ============================================================
-- 2. INSERTAR PROMPT GLOBAL DEL VISION AGENT
-- ============================================================

INSERT INTO agent_prompts (name, content, agent_type, client_id, version, description)
VALUES (
  'Vision Agent v1',
  $$Esta imagen fue enviada por un cliente interesado en productos.
Describe en una sola oración qué muestra: incluye marca, modelo, referencia, talla y color si son visibles.
Si es un pantallazo de catálogo o lista de precios, transcribe la información relevante del producto.
Si no contiene ningún producto identificable, responde exactamente: 'imagen sin producto identificable'.$$,
  'vision',
  NULL,
  1,
  'Prompt global del agente de visión — describe imágenes enviadas por clientes para inyectarlas al pipeline de ventas'
);

-- ============================================================
-- 3. ACTUALIZAR COMENTARIO
-- ============================================================

COMMENT ON COLUMN agent_prompts.agent_type IS
  '"sales" = agente conversacional del cliente | "intent" = extractor de intención (global) | "vision" = descriptor de imágenes (global)';

-- ============================================================
-- 4. VERIFICACIÓN
-- ============================================================

SELECT agent_type, name, version, is_active, client_id IS NULL AS is_global
FROM agent_prompts
ORDER BY agent_type, is_global DESC;
