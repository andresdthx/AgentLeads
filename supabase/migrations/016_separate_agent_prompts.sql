-- Migration 016: Separar prompts de la tabla clients
-- Crea tabla agent_prompts centralizada para sales e intent agents.
-- Migra datos existentes de clients.system_prompt a la nueva tabla.
-- Author: AgentsLeads
-- Date: 2026-02-19

-- ============================================================
-- 1. CREAR TABLA agent_prompts
-- ============================================================

CREATE TABLE agent_prompts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identificación
  name        TEXT NOT NULL,
  description TEXT,

  -- Contenido
  content     TEXT NOT NULL,
  agent_type  TEXT NOT NULL CHECK (agent_type IN ('sales', 'intent')),
  version     INTEGER NOT NULL DEFAULT 1,

  -- Scope: NULL = global (intent), UUID = per-client (sales)
  client_id   UUID REFERENCES clients(id) ON DELETE CASCADE,

  -- Control
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ
);

-- ============================================================
-- 2. MIGRAR PROMPTS DE SALES DESDE clients.system_prompt
-- ============================================================

INSERT INTO agent_prompts (name, content, agent_type, client_id, version, description)
SELECT
  c.name || ' — Sales Prompt v1',
  c.system_prompt,
  'sales',
  c.id,
  1,
  'Migrado automáticamente desde clients.system_prompt'
FROM clients c;

-- ============================================================
-- 3. INSERTAR PROMPT GLOBAL DEL INTENT AGENT
-- ============================================================

INSERT INTO agent_prompts (name, content, agent_type, client_id, version, description)
VALUES (
  'Intent Agent v1',
  $$Eres un extractor de intención de compra para una tienda de ropa y tenis (sneakers).

Analiza el historial de conversación y devuelve ÚNICAMENTE un JSON válido sin texto adicional.

Reglas:
- Si el cliente NO pregunta por productos específicos (ej: solo saluda, pregunta horarios, etc.), devuelve has_product_intent: false.
- needs_images: true solo si el cliente pide explícitamente fotos, catálogo o imágenes.
- sizes: extrae tallas mencionadas (ej: "42", "talla 9", "10 US") como strings normalizados.
- customer_type: "mayorista" si menciona compra de varias unidades o reventa, "detal" si es uso personal.
- confidence: "high" si hay datos claros, "medium" si se puede inferir, "low" si es muy ambiguo.

Formato de respuesta (JSON exacto, sin markdown):
{
  "has_product_intent": boolean,
  "brand": string | null,
  "model": string | null,
  "colors": string[],
  "sizes": string[],
  "customer_type": "detal" | "mayorista" | null,
  "needs_images": boolean,
  "confidence": "high" | "medium" | "low"
}$$,
  'intent',
  NULL,
  1,
  'Prompt global del agente de extracción de intención de compra'
);

-- ============================================================
-- 4. AGREGAR FK sales_prompt_id EN clients
-- ============================================================

ALTER TABLE clients
  ADD COLUMN sales_prompt_id UUID REFERENCES agent_prompts(id);

-- Apuntar cada cliente a su prompt migrado
UPDATE clients c
SET sales_prompt_id = (
  SELECT ap.id
  FROM agent_prompts ap
  WHERE ap.client_id = c.id
    AND ap.agent_type = 'sales'
    AND ap.is_active = true
  LIMIT 1
);

-- ============================================================
-- 5. ELIMINAR system_prompt DE clients (ya migrado)
-- ============================================================

ALTER TABLE clients DROP COLUMN system_prompt;

-- ============================================================
-- 6. ÍNDICES
-- ============================================================

-- Lookup del intent prompt global activo
CREATE INDEX idx_agent_prompts_intent_global
  ON agent_prompts (agent_type, is_active)
  WHERE client_id IS NULL;

-- Lookup de prompts por cliente
CREATE INDEX idx_agent_prompts_client_id
  ON agent_prompts (client_id, agent_type, is_active);

-- ============================================================
-- 7. TRIGGER updated_at
-- ============================================================

CREATE TRIGGER update_agent_prompts_updated_at
  BEFORE UPDATE ON agent_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- 8. RLS
-- ============================================================

ALTER TABLE agent_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to agent_prompts"
  ON agent_prompts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON agent_prompts TO service_role;

-- ============================================================
-- 9. COMENTARIOS
-- ============================================================

COMMENT ON TABLE agent_prompts IS 'Prompts de los agentes LLM. agent_type=sales es per-client, agent_type=intent es global (client_id NULL).';
COMMENT ON COLUMN agent_prompts.agent_type IS '"sales" = agente conversacional del cliente | "intent" = extractor de intención (global)';
COMMENT ON COLUMN agent_prompts.client_id IS 'NULL para prompts globales (intent). UUID del cliente para prompts de ventas.';
COMMENT ON COLUMN agent_prompts.is_active IS 'Solo un registro activo por (client_id, agent_type) debería estar activo simultáneamente.';
COMMENT ON COLUMN clients.sales_prompt_id IS 'FK al prompt activo de ventas en agent_prompts';

-- ============================================================
-- 10. VERIFICACIÓN
-- ============================================================

SELECT
  ap.agent_type,
  ap.name,
  ap.version,
  ap.is_active,
  c.name AS client_name,
  LEFT(ap.content, 80) AS content_preview
FROM agent_prompts ap
LEFT JOIN clients c ON c.id = ap.client_id
ORDER BY ap.agent_type, c.name;
