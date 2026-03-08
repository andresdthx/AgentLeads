// Intent Agent — extrae la intención de producto del historial de conversación
// Usa un LLM liviano con temperatura 0 para generar un JSON estructurado
// que se usa como query a la tabla client_products.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Message, ProductIntent, ClientConfig } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";
import { resolveApiKey } from "./llm.ts";

const logger = createLogger("intent");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Palabras clave globales — fallback cuando el cliente no tiene keywords configuradas.
// Cubre términos comunes de consulta de producto para el nicho de ropa/tenis.
const PRODUCT_KEYWORDS_FALLBACK =
  /\b(talla|tallas?|precio|precios?|ref\b|referencia|modelo|color|blanco|negro|rojo|verde|azul|gris|beige|tienen|hay\b|stock|disponible|cat[aá]logo|foto|fotos|imagen|im[aá]genes|muestrame|muestra|ver|quisiera|quiero|busco|necesito|estoy|buscando)\b/i;

/**
 * Pre-filtro sin costo LLM: devuelve true si el texto contiene keywords de producto.
 *
 * Si el cliente tiene `clientKeywords` configuradas (migration 045), se construye
 * una regex dinámica con esas keywords y se usa como override del fallback global.
 * Si `clientKeywords` está vacío, se aplica el fallback hardcodeado (comportamiento anterior).
 */
export function hasProductKeywords(
  text: string,
  clientKeywords?: string[]
): boolean {
  if (clientKeywords && clientKeywords.length > 0) {
    const escaped = clientKeywords.map((kw) =>
      kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    );
    const clientRegex = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
    return clientRegex.test(text);
  }
  return PRODUCT_KEYWORDS_FALLBACK.test(text);
}

// Fallback hardcodeado — se usa solo si la DB falla.
// Usa el schema de prompt_v3 para que parseIntentResponse lo procese uniformemente.
const INTENT_PROMPT_FALLBACK = `Eres un extractor de intención de compra para un negocio.

Analiza el historial de conversación y devuelve ÚNICAMENTE un JSON válido sin texto adicional.

Reglas:
- Si el cliente NO pregunta por productos/servicios específicos (ej: solo saluda, pregunta horarios, etc.), devuelve has_product_intent: false.
- needs_images: true solo si el cliente pide explícitamente fotos, catálogo o imágenes.
- sizes: extrae tallas mencionadas (ej: "42", "talla 9", "10 US") como strings normalizados.
- customer_type: "mayorista" si menciona compra de varias unidades o reventa, "detal" si es uso personal.
- confidence: "high" si hay datos claros, "medium" si se puede inferir, "low" si es muy ambiguo.

Formato de respuesta (JSON exacto, sin markdown):
{
  "intent_type": "product_specific" | "catalog_browse" | "category_browse" | "image_request" | "info_request" | "none",
  "has_product_intent": boolean,
  "brands": string[],
  "model": string | null,
  "reference": string | null,
  "category": string | null,
  "colors": string[],
  "sizes": string[],
  "customer_type": "detal" | "mayorista" | null,
  "needs_images": boolean,
  "confidence": "high" | "medium" | "low",
  "suggested_response_type": "send_catalog" | "ask_details" | "show_product" | "answer_info" | "greet"
}`;

// Cache con TTL — se invalida cada 5 min para que cambios en agent_prompts se reflejen sin reiniciar
let _cachedIntentPrompt: string | null = null;
let _intentCacheExpiresAt = 0;
const INTENT_CACHE_TTL_MS = 5 * 60 * 1000;

async function getIntentPrompt(): Promise<string> {
  if (_cachedIntentPrompt && Date.now() < _intentCacheExpiresAt) return _cachedIntentPrompt;

  const { data, error } = await supabase
    .from("agent_prompts")
    .select("content")
    .eq("agent_type", "intent")
    .eq("is_active", true)
    .is("client_id", null)
    .single();

  if (error || !data?.content) {
    logger.warn("No se encontró intent prompt en DB, usando fallback hardcodeado", { error });
    return INTENT_PROMPT_FALLBACK;
  }

  _cachedIntentPrompt = data.content as string;
  _intentCacheExpiresAt = Date.now() + INTENT_CACHE_TTL_MS;
  logger.debug("Intent prompt cargado desde DB y cacheado");
  return _cachedIntentPrompt;
}

const FALLBACK_INTENT: ProductIntent = {
  intent_type: "none",
  has_product_intent: false,
  brands: [],
  model: null,
  reference: null,
  category: null,
  colors: [],
  sizes: [],
  customer_type: null,
  needs_images: false,
  confidence: "low",
  suggested_response_type: "greet",
};

/**
 * Interpola los placeholders del prompt intent con datos del cliente.
 * Rellena {{brands}}, {{categories}} y {{business_description}} en el template.
 * La interpolación ocurre en runtime (post-caché) para no invalida el caché del template.
 */
function interpolateIntentPrompt(template: string, config: ClientConfig): string {
  const brands      = config.brands.length > 0 ? config.brands.join(", ") : "no especificadas";
  const categories  = config.categories.length > 0 ? config.categories.join(", ") : "no especificadas";
  const description = config.business_description ?? config.plan_name ?? "negocio";

  return template
    .replace(/\{\{brands\}\}/g, brands)
    .replace(/\{\{categories\}\}/g, categories)
    .replace(/\{\{business_description\}\}/g, description);
}

/**
 * Parsea la respuesta JSON del LLM al tipo ProductIntent.
 * Normaliza backward-compat: si el LLM devuelve `brand` (string, schema v1/v2),
 * lo convierte a `brands: [brand]` para no romper clientes con prompts antiguos.
 */
function parseIntentResponse(raw: string): ProductIntent {
  try {
    const json = JSON.parse(raw.trim());
    return {
      intent_type:            json.intent_type ?? "none",
      has_product_intent:     Boolean(json.has_product_intent),
      // Backward compat: prompt v1/v2 retorna brand (string), v3 retorna brands (array)
      brands: Array.isArray(json.brands)
        ? json.brands
        : json.brand
        ? [json.brand]
        : [],
      model:                  json.model ?? null,
      reference:              json.reference ?? null,
      category:               json.category ?? null,
      colors:                 Array.isArray(json.colors) ? json.colors : [],
      sizes:                  Array.isArray(json.sizes) ? json.sizes : [],
      customer_type:          json.customer_type ?? null,
      needs_images:           Boolean(json.needs_images),
      confidence:             json.confidence ?? "low",
      suggested_response_type: json.suggested_response_type ?? "answer_info",
    };
  } catch {
    logger.warn("Error parseando respuesta del Intent Agent, usando fallback", { raw });
    return FALLBACK_INTENT;
  }
}

/**
 * Extrae la intención de producto del historial reciente.
 * Usa el mismo proveedor/endpoint del plan del cliente con temperatura 0.
 */
export async function extractProductIntent(
  history: Message[],
  config: ClientConfig
): Promise<ProductIntent> {
  // Solo los últimos 4 mensajes son suficientes para detectar intención
  const recentHistory = history.slice(-4);

  const intentPromptTemplate = await getIntentPrompt();
  const intentPrompt = interpolateIntentPrompt(intentPromptTemplate, config);

  const messages = [
    { role: "system", content: intentPrompt },
    ...recentHistory.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  const apiKey = resolveApiKey(config.llm.provider_slug);

  const authHeader = config.llm.api_key_prefix
    ? `${config.llm.api_key_prefix} ${apiKey}`
    : apiKey;

  try {
    const response = await fetch(config.llm.chat_endpoint_url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [config.llm.api_key_header]: authHeader,
      },
      body: JSON.stringify({
        model: config.llm.model_id,
        messages,
        temperature: 0,
        max_tokens: 300,
      }),
    });

    const data = await response.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "{}";

    const intent = parseIntentResponse(raw);
    logger.debug("Intent extraído", { intent, history_length: recentHistory.length });
    return intent;
  } catch (e) {
    logger.warn("Error en Intent Agent, usando fallback sin-intención", { error: e });
    return FALLBACK_INTENT;
  }
}
