-- Migration 035: Update Vision Agent prompt to return structured JSON
--
-- v1 returned a free-text string — hard to parse programmatically.
-- v2 returns a JSON object with type, confidence, and structured product fields.
-- This enables the message handler to branch on confidence:
--   high   → use vision data directly (e.g. Canva catalog screenshot with full info)
--   medium → search external catalog (WooCommerce/Shopify) with extracted keywords
--   low    → redirect to human agent

-- Deactivate old prompt
UPDATE agent_prompts
SET is_active = false
WHERE agent_type = 'vision'
  AND client_id IS NULL;

-- Insert new structured prompt
INSERT INTO agent_prompts (name, content, agent_type, client_id, version, description)
VALUES (
  'Vision Agent v2 — JSON output',
  $$Analiza esta imagen enviada por un cliente interesado en comprar un producto.

Responde ÚNICAMENTE con JSON válido, sin texto adicional, en uno de estos tres formatos:

1. Si contiene un producto identificable:
{"type":"product","name":"","brand":null,"reference":null,"attributes":null,"price":null,"confidence":"high"}
- name: nombre o descripción del producto (obligatorio)
- brand: marca si es visible, null si no
- reference: referencia, modelo o código si es visible, null si no
- attributes: talla, color, fragancia, material, volumen u otras características relevantes — lo que aplique, null si no hay
- price: precio si está visible en la imagen, null si no
- confidence:
    "high"   → imagen de catálogo o producto con información completa (nombre, precio, referencia visibles)
    "medium" → producto reconocible pero información parcial (solo foto sin texto)
    "low"    → imagen ambigua, producto poco claro o sin contexto suficiente

2. Si es captura de catálogo con múltiples productos listados:
{"type":"catalog","products":[{"name":"","reference":null,"attributes":null,"price":null}]}

3. Si no hay ningún producto identificable:
{"type":"no_product"}$$,
  'vision',
  NULL,
  2,
  'Prompt global del agente de visión v2 — retorna JSON estructurado con tipo, confianza y campos del producto'
);

-- Verification
SELECT agent_type, name, version, is_active, client_id IS NULL AS is_global
FROM agent_prompts
WHERE agent_type = 'vision'
ORDER BY version DESC;
