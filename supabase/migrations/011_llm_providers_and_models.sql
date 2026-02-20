-- =============================================================================
-- Migration 011: LLM Providers, Models & Endpoints
-- =============================================================================
-- Estructura:
--   llm_providers      → empresas proveedoras (OpenAI, Anthropic, Google…)
--   llm_endpoints      → URLs base por tipo de capacidad del proveedor
--   llm_models         → modelos específicos de cada proveedor
--   llm_model_capabilities → qué puede hacer cada modelo
-- =============================================================================

-- ---------------------------------------------------------------------------
-- ENUMS
-- ---------------------------------------------------------------------------

CREATE TYPE llm_capability AS ENUM (
  'chat',             -- conversación / completion de texto
  'image_input',      -- el modelo acepta imágenes como entrada
  'image_generation', -- el modelo genera imágenes
  'audio_input',      -- transcripción / comprensión de audio
  'audio_output',     -- text-to-speech / síntesis de voz
  'embedding',        -- generación de vectores
  'function_calling', -- tool use / function calling
  'vision'            -- alias semántico para image_input (compatibilidad)
);

CREATE TYPE llm_endpoint_type AS ENUM (
  'chat_completions',
  'completions',
  'embeddings',
  'audio_transcriptions',
  'audio_speech',
  'images_generations',
  'images_edits',
  'models'
);

-- ---------------------------------------------------------------------------
-- TABLA: llm_providers
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_providers (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL UNIQUE,           -- "OpenAI", "Anthropic"…
  slug              TEXT        NOT NULL UNIQUE,           -- "openai", "anthropic"…
  base_url          TEXT        NOT NULL,                  -- https://api.openai.com/v1
  docs_url          TEXT,
  api_key_header    TEXT        NOT NULL DEFAULT 'Authorization', -- header a usar
  api_key_prefix    TEXT        NOT NULL DEFAULT 'Bearer',        -- "Bearer", "x-api-key"…
  is_active         BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE llm_providers IS 'Empresas / servicios proveedores de LLMs';

-- ---------------------------------------------------------------------------
-- TABLA: llm_endpoints
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_endpoints (
  id             UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    UUID              NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  endpoint_type  llm_endpoint_type NOT NULL,
  url            TEXT              NOT NULL,   -- URL completa del endpoint
  http_method    TEXT              NOT NULL DEFAULT 'POST',
  notes          TEXT,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, endpoint_type)
);

COMMENT ON TABLE llm_endpoints IS 'URLs específicas por tipo de operación para cada proveedor';

-- ---------------------------------------------------------------------------
-- TABLA: llm_models
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_models (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id               UUID        NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
  model_id                  TEXT        NOT NULL,  -- ID exacto para la API: "gpt-4o-mini"
  display_name              TEXT        NOT NULL,  -- Nombre legible
  context_window_tokens     INTEGER,               -- tokens de contexto máximo
  max_output_tokens         INTEGER,               -- tokens de salida máximo
  input_price_per_1m_tokens NUMERIC(10,4),         -- USD por millón de tokens de entrada
  output_price_per_1m_tokens NUMERIC(10,4),        -- USD por millón de tokens de salida
  knowledge_cutoff          DATE,
  is_active                 BOOLEAN     NOT NULL DEFAULT TRUE,
  is_deprecated             BOOLEAN     NOT NULL DEFAULT FALSE,
  notes                     TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, model_id)
);

COMMENT ON TABLE llm_models IS 'Modelos específicos de cada proveedor con pricing y límites';

-- ---------------------------------------------------------------------------
-- TABLA: llm_model_capabilities
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS llm_model_capabilities (
  id          UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id    UUID           NOT NULL REFERENCES llm_models(id) ON DELETE CASCADE,
  capability  llm_capability NOT NULL,
  notes       TEXT,
  UNIQUE (model_id, capability)
);

COMMENT ON TABLE llm_model_capabilities IS 'Capacidades soportadas por cada modelo';

-- ---------------------------------------------------------------------------
-- VISTA CONVENIENTE
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW llm_models_full AS
SELECT
  m.model_id,
  m.display_name,
  p.name                        AS provider_name,
  p.slug                        AS provider_slug,
  p.base_url,
  p.api_key_header,
  p.api_key_prefix,
  m.context_window_tokens,
  m.max_output_tokens,
  m.input_price_per_1m_tokens,
  m.output_price_per_1m_tokens,
  m.knowledge_cutoff,
  m.is_active,
  m.is_deprecated,
  m.notes,
  ARRAY_AGG(mc.capability ORDER BY mc.capability) AS capabilities
FROM llm_models m
JOIN llm_providers p ON p.id = m.provider_id
LEFT JOIN llm_model_capabilities mc ON mc.model_id = m.id
GROUP BY m.id, p.id;

COMMENT ON VIEW llm_models_full IS 'Vista consolidada: modelo + proveedor + capacidades';

-- =============================================================================
-- SEED DATA
-- =============================================================================

-- ---------------------------------------------------------------------------
-- PROVEEDORES
-- ---------------------------------------------------------------------------

INSERT INTO llm_providers (name, slug, base_url, docs_url, api_key_header, api_key_prefix) VALUES
  ('OpenAI',      'openai',      'https://api.openai.com/v1',                     'https://platform.openai.com/docs',          'Authorization',  'Bearer'),
  ('Anthropic',   'anthropic',   'https://api.anthropic.com/v1',                  'https://docs.anthropic.com',                'x-api-key',      ''),
  ('Google',      'google',      'https://generativelanguage.googleapis.com/v1beta','https://ai.google.dev/api',               'Authorization',  'Bearer'),
  ('Mistral AI',  'mistral',     'https://api.mistral.ai/v1',                     'https://docs.mistral.ai',                   'Authorization',  'Bearer'),
  ('Groq',        'groq',        'https://api.groq.com/openai/v1',                'https://console.groq.com/docs',             'Authorization',  'Bearer'),
  ('Together AI', 'together',    'https://api.together.xyz/v1',                   'https://docs.together.ai',                  'Authorization',  'Bearer'),
  ('Cohere',      'cohere',      'https://api.cohere.com/v2',                     'https://docs.cohere.com',                   'Authorization',  'Bearer'),
  ('xAI',         'xai',         'https://api.x.ai/v1',                           'https://docs.x.ai',                         'Authorization',  'Bearer')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- ENDPOINTS POR PROVEEDOR
-- ---------------------------------------------------------------------------

-- OpenAI
INSERT INTO llm_endpoints (provider_id, endpoint_type, url) VALUES
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'chat_completions',    'https://api.openai.com/v1/chat/completions'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'embeddings',          'https://api.openai.com/v1/embeddings'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'audio_transcriptions','https://api.openai.com/v1/audio/transcriptions'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'audio_speech',        'https://api.openai.com/v1/audio/speech'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'images_generations',  'https://api.openai.com/v1/images/generations'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'images_edits',        'https://api.openai.com/v1/images/edits'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'models',              'https://api.openai.com/v1/models')
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- Anthropic
INSERT INTO llm_endpoints (provider_id, endpoint_type, url) VALUES
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'chat_completions', 'https://api.anthropic.com/v1/messages'),
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'models',           'https://api.anthropic.com/v1/models')
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- Google
INSERT INTO llm_endpoints (provider_id, endpoint_type, url, notes) VALUES
  ((SELECT id FROM llm_providers WHERE slug='google'), 'chat_completions',   'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',  'Reemplazar {model} con el model_id'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'embeddings',          'https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent',     'Reemplazar {model} con el model_id'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'audio_transcriptions','https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',  'Audio via multimodal input')
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- Mistral
INSERT INTO llm_endpoints (provider_id, endpoint_type, url) VALUES
  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'chat_completions', 'https://api.mistral.ai/v1/chat/completions'),
  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'embeddings',        'https://api.mistral.ai/v1/embeddings'),
  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'models',            'https://api.mistral.ai/v1/models')
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- Groq
INSERT INTO llm_endpoints (provider_id, endpoint_type, url, notes) VALUES
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'chat_completions',    'https://api.groq.com/openai/v1/chat/completions',    'Compatible con SDK de OpenAI'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'audio_transcriptions','https://api.groq.com/openai/v1/audio/transcriptions', 'Whisper ultra-rápido'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'models',              'https://api.groq.com/openai/v1/models',               NULL)
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- Together AI
INSERT INTO llm_endpoints (provider_id, endpoint_type, url) VALUES
  ((SELECT id FROM llm_providers WHERE slug='together'), 'chat_completions', 'https://api.together.xyz/v1/chat/completions'),
  ((SELECT id FROM llm_providers WHERE slug='together'), 'images_generations','https://api.together.xyz/v1/images/generations'),
  ((SELECT id FROM llm_providers WHERE slug='together'), 'embeddings',        'https://api.together.xyz/v1/embeddings')
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- Cohere
INSERT INTO llm_endpoints (provider_id, endpoint_type, url) VALUES
  ((SELECT id FROM llm_providers WHERE slug='cohere'), 'chat_completions', 'https://api.cohere.com/v2/chat'),
  ((SELECT id FROM llm_providers WHERE slug='cohere'), 'embeddings',        'https://api.cohere.com/v2/embed')
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- xAI
INSERT INTO llm_endpoints (provider_id, endpoint_type, url) VALUES
  ((SELECT id FROM llm_providers WHERE slug='xai'), 'chat_completions', 'https://api.x.ai/v1/chat/completions'),
  ((SELECT id FROM llm_providers WHERE slug='xai'), 'images_generations','https://api.x.ai/v1/images/generations')
ON CONFLICT (provider_id, endpoint_type) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MODELOS — OpenAI
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (provider_id, model_id, display_name, context_window_tokens, max_output_tokens, input_price_per_1m_tokens, output_price_per_1m_tokens, knowledge_cutoff, notes) VALUES

  -- GPT-4o family
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'gpt-4o',            'GPT-4o',            128000, 16384,  2.50,  10.00, '2024-04-01', 'Flagship multimodal: texto, imagen y audio'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'gpt-4o-mini',       'GPT-4o mini',       128000, 16384,  0.15,   0.60, '2024-07-01', 'Versión compacta y económica de GPT-4o'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'gpt-4o-audio-preview','GPT-4o Audio Preview', 128000, 16384, 2.50, 10.00, '2024-10-01', 'GPT-4o con entrada/salida de audio nativa'),

  -- GPT-4.5
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'gpt-4.5-preview',   'GPT-4.5 Preview',   128000, 16384, 75.00, 150.00, '2024-10-01', 'Mayor capacidad de razonamiento y contexto emocional'),

  -- o-series (razonamiento)
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'o1',                'o1',                200000, 100000, 15.00,  60.00, '2024-04-01', 'Razonamiento paso a paso para tareas complejas'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'o1-mini',           'o1 mini',           128000,  65536,  3.00,  12.00, '2024-07-01', 'Razonamiento rápido y económico'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'o3-mini',           'o3 mini',           200000, 100000,  1.10,   4.40, '2024-10-01', 'Sucesor de o1-mini, mayor eficiencia'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'o3',                'o3',                200000, 100000, 10.00,  40.00, '2024-10-01', 'Razonamiento de nivel frontier'),

  -- GPT-4 Turbo (legacy activo)
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'gpt-4-turbo',       'GPT-4 Turbo',       128000,  4096,  10.00,  30.00, '2023-12-01', 'GPT-4 con ventana extendida'),

  -- Audio / Speech
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'whisper-1',         'Whisper v1',        NULL,    NULL,   0.006,  NULL, NULL,         'Transcripción de audio — precio por minuto ($0.006/min)'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'tts-1',             'TTS-1',             NULL,    NULL,   15.00,  NULL, NULL,         'Text-to-Speech estándar — precio por 1M caracteres'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'tts-1-hd',          'TTS-1 HD',          NULL,    NULL,   30.00,  NULL, NULL,         'Text-to-Speech alta definición'),

  -- Image generation
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'dall-e-3',          'DALL·E 3',          NULL,    NULL,   NULL,   NULL, NULL,         'Generación de imágenes de alta calidad (precio por imagen)'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'dall-e-2',          'DALL·E 2',          NULL,    NULL,   NULL,   NULL, NULL,         'Generación/edición de imágenes (precio por imagen)'),

  -- Embeddings
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'text-embedding-3-small','Embedding 3 Small', NULL, NULL,  0.02,   NULL, NULL,         'Embeddings rápidos y económicos (1536 dims)'),
  ((SELECT id FROM llm_providers WHERE slug='openai'), 'text-embedding-3-large','Embedding 3 Large', NULL, NULL,  0.13,   NULL, NULL,         'Embeddings de alta precisión (3072 dims)')

ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MODELOS — Anthropic
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (provider_id, model_id, display_name, context_window_tokens, max_output_tokens, input_price_per_1m_tokens, output_price_per_1m_tokens, knowledge_cutoff, notes) VALUES

  -- Claude 4 family (2025-2026)
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'claude-opus-4-6',           'Claude Opus 4.6',            200000,  32000,  15.00,  75.00, '2025-04-01', 'Modelo más capaz de Anthropic'),
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'claude-sonnet-4-6',          'Claude Sonnet 4.6',          200000,  16000,   3.00,  15.00, '2025-04-01', 'Balance rendimiento/costo — modelo actual en producción'),
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'claude-haiku-4-5-20251001',  'Claude Haiku 4.5',           200000,   8192,   0.80,   4.00, '2025-04-01', 'Modelo más rápido y económico de la familia 4'),

  -- Claude 3.5 family
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'claude-3-5-sonnet-20241022', 'Claude 3.5 Sonnet',          200000,   8192,   3.00,  15.00, '2024-04-01', 'Anterior flagship — excelente en código y análisis'),
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'claude-3-5-haiku-20241022',  'Claude 3.5 Haiku',           200000,   8192,   0.80,   4.00, '2024-07-01', 'Versión rápida y económica de Claude 3.5'),

  -- Claude 3 family (legacy)
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'claude-3-opus-20240229',     'Claude 3 Opus',              200000,   4096,  15.00,  75.00, '2023-08-01', 'Modelo legacy de alta capacidad'),
  ((SELECT id FROM llm_providers WHERE slug='anthropic'), 'claude-3-haiku-20240307',    'Claude 3 Haiku',             200000,   4096,   0.25,   1.25, '2023-08-01', 'Modelo legacy ultra-rápido')

ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MODELOS — Google (Gemini)
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (provider_id, model_id, display_name, context_window_tokens, max_output_tokens, input_price_per_1m_tokens, output_price_per_1m_tokens, knowledge_cutoff, notes) VALUES

  ((SELECT id FROM llm_providers WHERE slug='google'), 'gemini-2.0-flash',         'Gemini 2.0 Flash',         1048576, 8192,  0.10,  0.40, '2025-01-01', 'Modelo rápido de próxima generación — multimodal nativo'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'gemini-2.0-flash-thinking', 'Gemini 2.0 Flash Thinking',1048576, 8192,  0.10,  0.40, '2025-01-01', 'Flash con razonamiento explícito'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'gemini-2.0-pro-exp',        'Gemini 2.0 Pro Exp',       2097152,8192,  NULL,  NULL, '2025-01-01', 'Experimental — ventana de contexto de 2M tokens'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'gemini-1.5-pro',            'Gemini 1.5 Pro',           2097152,8192,  1.25,  5.00, '2024-05-01', 'Contexto de 2M tokens, multimodal'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'gemini-1.5-flash',          'Gemini 1.5 Flash',         1048576,8192,  0.075, 0.30, '2024-05-01', 'Versión rápida y económica de Gemini 1.5'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'gemini-1.5-flash-8b',       'Gemini 1.5 Flash 8B',      1048576,8192,  0.0375,0.15, '2024-05-01', 'Variante 8B ultra-económica'),
  ((SELECT id FROM llm_providers WHERE slug='google'), 'text-embedding-004',        'Text Embedding 004',       NULL,   NULL,  0.000125,NULL,'2024-05-01','Embeddings de alta calidad (768 dims)')

ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MODELOS — Mistral AI
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (provider_id, model_id, display_name, context_window_tokens, max_output_tokens, input_price_per_1m_tokens, output_price_per_1m_tokens, knowledge_cutoff, notes) VALUES

  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'mistral-large-latest',  'Mistral Large',      131072, 4096,  2.00,  6.00, '2024-01-01', 'Modelo más potente de Mistral'),
  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'mistral-small-latest',  'Mistral Small',       32768, 4096,  0.20,  0.60, '2024-01-01', 'Eficiente y económico'),
  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'mistral-nemo',          'Mistral NeMo',       128000, 4096,  0.15,  0.15, '2024-01-01', 'Modelo 12B Apache 2.0'),
  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'codestral-latest',      'Codestral',          256000, 4096,  0.20,  0.60, '2024-01-01', 'Especializado en generación de código'),
  ((SELECT id FROM llm_providers WHERE slug='mistral'), 'mistral-embed',         'Mistral Embed',        8192, NULL,  0.10,  NULL, '2024-01-01', 'Embeddings (1024 dims)')

ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MODELOS — Groq (inferencia ultrarrápida)
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (provider_id, model_id, display_name, context_window_tokens, max_output_tokens, input_price_per_1m_tokens, output_price_per_1m_tokens, knowledge_cutoff, notes) VALUES

  ((SELECT id FROM llm_providers WHERE slug='groq'), 'llama-3.3-70b-versatile',   'Llama 3.3 70B',       128000, 32768, 0.59,  0.79, '2024-12-01', 'Meta Llama 3.3 70B vía Groq'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'llama-3.1-8b-instant',      'Llama 3.1 8B Instant', 131072, 8192, 0.05,  0.08, '2023-12-01', 'Ultra-rápido para tareas simples'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'llama3-70b-8192',           'Llama 3 70B',           8192,  8192, 0.59,  0.79, '2023-12-01', 'Meta Llama 3 70B'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'mixtral-8x7b-32768',        'Mixtral 8x7B',          32768, 32768, 0.24,  0.24, '2023-12-01', 'MoE 8x7B de Mistral'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'gemma2-9b-it',              'Gemma 2 9B IT',          8192,  8192, 0.20,  0.20, '2024-06-01', 'Google Gemma 2 9B Instruct'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'whisper-large-v3',          'Whisper Large v3',      NULL,   NULL,  0.111, NULL, NULL,         'Transcripción de audio — precio por hora ($0.111/hr)'),
  ((SELECT id FROM llm_providers WHERE slug='groq'), 'whisper-large-v3-turbo',    'Whisper Large v3 Turbo',NULL,  NULL,  0.04,  NULL, NULL,         'Versión turbo más rápida y económica')

ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MODELOS — xAI (Grok)
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (provider_id, model_id, display_name, context_window_tokens, max_output_tokens, input_price_per_1m_tokens, output_price_per_1m_tokens, knowledge_cutoff, notes) VALUES

  ((SELECT id FROM llm_providers WHERE slug='xai'), 'grok-2-latest',       'Grok 2',        131072, 4096,  2.00, 10.00, '2024-11-01', 'Flagship de xAI con acceso a X/Twitter'),
  ((SELECT id FROM llm_providers WHERE slug='xai'), 'grok-2-vision-1212',  'Grok 2 Vision', 32768,  4096,  2.00, 10.00, '2024-11-01', 'Grok 2 con visión — análisis de imágenes'),
  ((SELECT id FROM llm_providers WHERE slug='xai'), 'grok-2-image-1212',   'Grok 2 Image',  NULL,   NULL,  NULL,  NULL, '2024-11-01', 'Generación de imágenes con Aurora')

ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- MODELOS — Cohere
-- ---------------------------------------------------------------------------

INSERT INTO llm_models (provider_id, model_id, display_name, context_window_tokens, max_output_tokens, input_price_per_1m_tokens, output_price_per_1m_tokens, knowledge_cutoff, notes) VALUES

  ((SELECT id FROM llm_providers WHERE slug='cohere'), 'command-r-plus-08-2024', 'Command R+ (Aug 2024)', 128000, 4096, 2.50, 10.00, '2024-03-01', 'RAG y tareas complejas de empresa'),
  ((SELECT id FROM llm_providers WHERE slug='cohere'), 'command-r-08-2024',      'Command R (Aug 2024)',  128000, 4096, 0.15,  0.60, '2024-03-01', 'RAG económico'),
  ((SELECT id FROM llm_providers WHERE slug='cohere'), 'embed-multilingual-v3.0','Embed Multilingual v3', NULL,   NULL, 0.10,  NULL, '2023-12-01', 'Embeddings multilingüe 1024 dims'),
  ((SELECT id FROM llm_providers WHERE slug='cohere'), 'embed-english-v3.0',     'Embed English v3',      NULL,   NULL, 0.10,  NULL, '2023-12-01', 'Embeddings inglés 1024 dims')

ON CONFLICT (provider_id, model_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- CAPACIDADES
-- ---------------------------------------------------------------------------

-- Helper: insert capabilities en bulk por model_id texto + provider slug
-- OpenAI GPT-4o
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m
JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','image_input','audio_input','audio_output','function_calling','vision']::llm_capability[]) AS cap
WHERE p.slug = 'openai' AND m.model_id = 'gpt-4o'
ON CONFLICT DO NOTHING;

-- OpenAI GPT-4o-mini
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','image_input','function_calling','vision']::llm_capability[]) AS cap
WHERE p.slug = 'openai' AND m.model_id = 'gpt-4o-mini'
ON CONFLICT DO NOTHING;

-- OpenAI gpt-4o-audio-preview
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','audio_input','audio_output','function_calling']::llm_capability[]) AS cap
WHERE p.slug = 'openai' AND m.model_id = 'gpt-4o-audio-preview'
ON CONFLICT DO NOTHING;

-- OpenAI gpt-4.5-preview
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','image_input','function_calling','vision']::llm_capability[]) AS cap
WHERE p.slug = 'openai' AND m.model_id = 'gpt-4.5-preview'
ON CONFLICT DO NOTHING;

-- OpenAI o1 / o3 (razonamiento — no function calling por defecto)
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'chat'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id IN ('o1','o1-mini','o3-mini','o3')
ON CONFLICT DO NOTHING;

INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'image_input'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id IN ('o1','o3')
ON CONFLICT DO NOTHING;

-- OpenAI Whisper
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'audio_input'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id = 'whisper-1'
ON CONFLICT DO NOTHING;

-- OpenAI TTS
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'audio_output'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id IN ('tts-1','tts-1-hd')
ON CONFLICT DO NOTHING;

-- OpenAI DALL-E
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'image_generation'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id IN ('dall-e-3','dall-e-2')
ON CONFLICT DO NOTHING;

-- OpenAI Embeddings
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'embedding'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'openai' AND m.model_id LIKE 'text-embedding%'
ON CONFLICT DO NOTHING;

-- OpenAI GPT-4 Turbo
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','image_input','function_calling','vision']::llm_capability[]) AS cap
WHERE p.slug = 'openai' AND m.model_id = 'gpt-4-turbo'
ON CONFLICT DO NOTHING;

-- Anthropic Claude (todos soportan chat + function calling)
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','image_input','function_calling','vision']::llm_capability[]) AS cap
WHERE p.slug = 'anthropic'
ON CONFLICT DO NOTHING;

-- Google Gemini (multimodal nativo)
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','image_input','audio_input','function_calling','vision']::llm_capability[]) AS cap
WHERE p.slug = 'google' AND m.model_id NOT LIKE '%embedding%'
ON CONFLICT DO NOTHING;

-- Google Embeddings
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'embedding'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'google' AND m.model_id LIKE '%embedding%'
ON CONFLICT DO NOTHING;

-- Mistral (chat + function calling)
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','function_calling']::llm_capability[]) AS cap
WHERE p.slug = 'mistral' AND m.model_id != 'mistral-embed'
ON CONFLICT DO NOTHING;

-- Mistral embeddings
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'embedding'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'mistral' AND m.model_id = 'mistral-embed'
ON CONFLICT DO NOTHING;

-- Groq LLMs (chat + function calling)
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','function_calling']::llm_capability[]) AS cap
WHERE p.slug = 'groq' AND m.model_id NOT LIKE 'whisper%'
ON CONFLICT DO NOTHING;

-- Groq Whisper
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'audio_input'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'groq' AND m.model_id LIKE 'whisper%'
ON CONFLICT DO NOTHING;

-- xAI Grok
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','function_calling']::llm_capability[]) AS cap
WHERE p.slug = 'xai' AND m.model_id NOT LIKE '%image%'
ON CONFLICT DO NOTHING;

INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'vision'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'xai' AND m.model_id LIKE '%vision%'
ON CONFLICT DO NOTHING;

INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'image_generation'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'xai' AND m.model_id LIKE '%image%'
ON CONFLICT DO NOTHING;

-- Cohere
INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, cap::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
CROSS JOIN UNNEST(ARRAY['chat','function_calling']::llm_capability[]) AS cap
WHERE p.slug = 'cohere' AND m.model_id LIKE 'command%'
ON CONFLICT DO NOTHING;

INSERT INTO llm_model_capabilities (model_id, capability)
SELECT m.id, 'embedding'::llm_capability
FROM llm_models m JOIN llm_providers p ON p.id = m.provider_id
WHERE p.slug = 'cohere' AND m.model_id LIKE 'embed%'
ON CONFLICT DO NOTHING;

-- =============================================================================
-- QUERIES DE VERIFICACIÓN (comentadas — ejecutar manualmente si se requiere)
-- =============================================================================

-- Ver todos los modelos con sus capacidades:
-- SELECT model_id, display_name, provider_name, capabilities
-- FROM llm_models_full
-- ORDER BY provider_name, display_name;

-- Modelos que soportan audio_input:
-- SELECT model_id, display_name, provider_name
-- FROM llm_models_full
-- WHERE 'audio_input' = ANY(capabilities);

-- Modelos multimodales (chat + imagen + audio):
-- SELECT model_id, display_name, provider_name
-- FROM llm_models_full
-- WHERE capabilities @> ARRAY['chat','image_input','audio_input']::llm_capability[];

-- Endpoints de chat de todos los proveedores:
-- SELECT p.name, e.url FROM llm_endpoints e
-- JOIN llm_providers p ON p.id = e.provider_id
-- WHERE e.endpoint_type = 'chat_completions';
