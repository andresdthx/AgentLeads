-- Migration: Add clients table and dynamic prompts
-- Author: AgentsLeads
-- Date: 2026-02-16

-- ============================================
-- CREATE CLIENTS TABLE
-- ============================================

CREATE TABLE clients (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Client info
  name TEXT NOT NULL,
  business_type TEXT,
  active BOOLEAN DEFAULT true,

  -- Prompt configuration
  system_prompt TEXT NOT NULL,
  llm_model TEXT DEFAULT 'gpt-4o-mini',
  llm_temperature NUMERIC(3,2) DEFAULT 0.7,
  conversation_history_limit INTEGER DEFAULT 10,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ============================================
-- ALTER LEADS TABLE
-- ============================================

-- Add client_id to leads
ALTER TABLE leads
  ADD COLUMN client_id UUID REFERENCES clients(id);

-- ============================================
-- CREATE DEFAULT CLIENT
-- ============================================

INSERT INTO clients (
  name,
  business_type,
  system_prompt,
  active
) VALUES (
  'Default Client',
  'General',
  'Eres un agente de ventas directo y conversacional.
Tu objetivo es identificar si el usuario está listo para comprar, analizando sus mensajes naturalmente.

Reglas:
- Sé muy breve, máximo 1-2 oraciones por respuesta
- Tono directo y casual, sin adulaciones ni comentarios innecesarios
- No repitas lo que el usuario dice, ve directo al punto
- Preguntas cortas y concretas (ej: "¿Qué estilo busca?" en vez de "¿Tiene en mente algún estilo específico?")
- Evita frases como "excelente", "genial", "perfecto" al inicio
- Responde siempre en español
- Lenguaje simple y directo

Señales de intención de compra (HOT):
- Menciona urgencia o fechas específicas
- Pregunta por precios, cotizaciones o formas de pago
- Usa frases como "necesito", "quiero", "me interesa", "cuándo pueden empezar"
- Menciona presupuesto disponible
- Pregunta por el proceso o siguientes pasos
- Tiene autoridad de decisión clara

Señales de interés moderado (WARM):
- Pregunta por información general
- Compara opciones
- Menciona "estoy viendo", "me gustaría saber"
- No hay urgencia evidente

Señales de bajo interés (COLD):
- Solo pregunta precios sin contexto
- Respuestas vagas o evasivas
- No muestra urgencia ni compromiso

Cuando puedas determinar la intención de compra, agrega al FINAL de tu respuesta:
CLASIFICACION
{score: 0-100, classification: hot|warm|cold, extracted: {need: ..., timeline: ..., budget: ..., authority: ...}, reasoning: ...}
FIN

Si no tienes suficiente información, solo conversa naturalmente sin incluir el bloque.',
  true
);

-- ============================================
-- UPDATE EXISTING LEADS
-- ============================================

-- Assign default client to existing leads
UPDATE leads
SET client_id = (SELECT id FROM clients WHERE name = 'Default Client' LIMIT 1)
WHERE client_id IS NULL;

-- ============================================
-- CREATE INDEXES
-- ============================================

CREATE INDEX idx_clients_active ON clients(active);
CREATE INDEX idx_leads_client_id ON leads(client_id);

-- ============================================
-- ADD TRIGGER
-- ============================================

CREATE TRIGGER update_clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ENABLE RLS
-- ============================================

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to clients"
  ON clients
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

GRANT ALL ON clients TO service_role;

-- ============================================
-- COMMENTS
-- ============================================

COMMENT ON TABLE clients IS 'Stores client configurations and custom prompts';
COMMENT ON COLUMN clients.system_prompt IS 'Custom system prompt for this client LLM agent';
COMMENT ON COLUMN clients.llm_model IS 'LLM model to use (e.g., gpt-4o-mini, gpt-4)';
COMMENT ON COLUMN clients.llm_temperature IS 'Temperature setting for LLM responses (0.0-1.0)';
