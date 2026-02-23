-- Migration 021: Create client "La Veleria"
-- product_mode = catalog (shares catalog URL, no inventory DB)
-- channel_phone_number = placeholder — UPDATE before going live

-- ============================================================
-- 1. CREAR SALES PROMPT PARA LA VELERIA
-- ============================================================

INSERT INTO agent_prompts (name, content, agent_type, client_id, version, description)
VALUES (
  'La Veleria — Sales Prompt v1',
  $$Eres un agente de ventas de La Veleria en WhatsApp.
Tu objetivo es atender clientes de forma cálida y directa, guiarlos por el catálogo y capturar pedidos confirmados.

## REGLAS CONVERSACIONALES
1. Máximo 1-2 oraciones por mensaje (WhatsApp es rápido)
2. Una sola pregunta por mensaje — nunca dos
3. Tono amable y cercano
4. Responde siempre en español
5. Evita frases robóticas: "excelente", "perfecto", "por supuesto"

## FLUJO CON CATÁLOGO
Cuando el cliente pregunte por productos, precios o referencias:
- Comparte el enlace del catálogo UNA sola vez por conversación
- Pídele que te diga la referencia o producto que le interesó
- Si el cliente ya tiene la referencia, consulta disponibilidad y cierra el pedido

## CONFIRMAR PEDIDO
Cuando el cliente confirme que quiere comprar un producto, recopila:
- Producto / referencia exacta
- Ciudad de envío
- Tipo de cliente: detal (uso personal) o mayorista (reventa)

Una vez tengas los tres datos, confirma el pedido en formato JSON al final de tu respuesta:

```json
{
  "pedido_confirmado": true,
  "ciudad_envio": "ciudad",
  "tipo_cliente": "detal|mayorista",
  "items": [
    {"producto": "nombre/referencia", "talla": "talla o null", "cantidad": 1}
  ]
}
```

## CLASIFICACIÓN DE LEADS
Cuando tengas suficiente información (mínimo 3 mensajes o 1 señal fuerte de compra), agrega al FINAL de tu respuesta:

CLASIFICACION
{"score": 0-100, "classification": "hot|warm|cold", "extracted": {"need": "descripción", "timeline": "urgencia", "budget": "presupuesto", "authority": "decisor"}, "reasoning": "señal clave"}
FIN

Si no tienes información suficiente, conversa naturalmente sin incluir el bloque.$$,
  'sales',
  NULL, -- se actualizará con el client_id real al crear el cliente
  1,
  'Prompt de ventas para La Veleria — modo catálogo'
);

-- ============================================================
-- 2. CREAR CLIENTE LA VELERIA
-- ============================================================

WITH new_prompt AS (
  SELECT id FROM agent_prompts
  WHERE name = 'La Veleria — Sales Prompt v1'
  LIMIT 1
),
basico_plan AS (
  SELECT id FROM plans WHERE name = 'basico' LIMIT 1
)
INSERT INTO clients (
  name,
  business_type,
  channel_phone_number,
  active,
  sales_prompt_id,
  plan_id,
  llm_model,
  llm_temperature,
  conversation_history_limit,
  product_mode,
  catalog_url
)
SELECT
  'La Veleria',
  'retail_catalog',
  '+57_PENDIENTE',        -- ⚠️  ACTUALIZAR antes de activar
  false,                  -- inactivo hasta configurar el canal
  new_prompt.id,
  basico_plan.id,
  'gpt-4o-mini',
  0.7,
  10,
  'catalog',
  'https://catalogoslaveleria.my.canva.site/cat-logos?utm_source=ig&utm_medium=social&utm_content=link_in_bio&fbclid=PAZXh0bgNhZW0CMTEAc3J0YwZhcHBfaWQMMjU2MjgxMDQwNTU4AAGnsvV5OU6qydRKSc5RL9TNf7Sdw9Hef7KrJy8Ydu45-6yZ7DUvjRjkiYU82mg_aem_4_W_klht2Y8Q7OehWRUHaQ'
FROM new_prompt, basico_plan;

-- ============================================================
-- 3. VINCULAR PROMPT AL CLIENT_ID REAL
-- ============================================================

UPDATE agent_prompts ap
SET client_id = c.id
FROM clients c
WHERE c.name = 'La Veleria'
  AND ap.name = 'La Veleria — Sales Prompt v1';

-- ============================================================
-- 4. VERIFICACIÓN
-- ============================================================

SELECT
  c.id,
  c.name,
  c.channel_phone_number,
  c.active,
  c.product_mode,
  c.catalog_url,
  c.llm_model,
  c.llm_temperature,
  p.display_name AS plan,
  ap.name AS sales_prompt
FROM clients c
LEFT JOIN plans p ON p.id = c.plan_id
LEFT JOIN agent_prompts ap ON ap.id = c.sales_prompt_id
WHERE c.name = 'La Veleria';
