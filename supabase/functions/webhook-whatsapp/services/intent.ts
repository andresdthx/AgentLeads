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

// Palabras clave que sugieren consulta de producto — pre-filtro sin costo LLM
const PRODUCT_KEYWORDS =
  /\b(talla|tallas?|precio|precios?|ref\b|referencia|modelo|color|blanco|negro|rojo|verde|azul|gris|beige|tienen|hay\b|stock|disponible|cat[aá]logo|foto|fotos|imagen|im[aá]genes|muestrame|muestra|ver|quisiera|quiero|busco|necesito|estoy|buscando)\b/i;

export function hasProductKeywords(text: string): boolean {
  return PRODUCT_KEYWORDS.test(text);
}

// Fallback hardcodeado — se usa solo si la DB falla
const INTENT_PROMPT_FALLBACK = `Eres un extractor de intención de compra para una tienda de ropa y tenis (sneakers).

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
  has_product_intent: false,
  brand: null,
  model: null,
  colors: [],
  sizes: [],
  customer_type: null,
  needs_images: false,
  confidence: "low",
};

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

  const intentPrompt = await getIntentPrompt();

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
        max_tokens: 200,
      }),
    });

    const data = await response.json();
    const raw: string = data.choices?.[0]?.message?.content ?? "{}";

    const intent = JSON.parse(raw.trim()) as ProductIntent;
    logger.debug("Intent extraído", { intent, history_length: recentHistory.length });
    return intent;
  } catch (e) {
    logger.warn("Error en Intent Agent, usando fallback sin-intención", { error: e });
    return FALLBACK_INTENT;
  }
}
