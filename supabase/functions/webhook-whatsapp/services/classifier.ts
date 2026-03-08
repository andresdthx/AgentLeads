// Classifier Agent — analiza el historial de conversación y clasifica el lead.
//
// DISEÑO DELIBERADO: este agente es completamente independiente del agente de ventas.
// Usa temperatura=0 para resultados deterministas y no tiene personalidad ni rol
// conversacional. Esto evita el problema de "doble personalidad" donde el mismo
// LLM tenía que ser vendedor cálido Y analista frío al mismo tiempo.
//
// El prompt vive exclusivamente en la tabla agent_prompts (agent_type='classifier').
// Si no existe el registro activo, la clasificación se omite con reasoning descriptivo.
//
// Se llama DESPUÉS de que el mensaje ya fue enviado al cliente, por lo que un
// fallo en la clasificación nunca afecta la experiencia del usuario.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Message, Classification } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";
import { resolveApiKey } from "./llm.ts";

const logger = createLogger("classifier");

// Hardcoded to OpenAI gpt-4o-mini for cost efficiency.
// Classification requires structured JSON output, not prose — gpt-4o-mini is sufficient.
// Using the client's plan model here would create unexpected billing on Pro plans.
const CLASSIFIER_MODEL = "gpt-4o-mini";
const CLASSIFIER_ENDPOINT = "https://api.openai.com/v1/chat/completions";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// ---------------------------------------------------------------------------
// Prompt de clasificación — leído desde agent_prompts en la DB.
// Cache con TTL para evitar una query por mensaje.
// ---------------------------------------------------------------------------

let _cachedPrompt: string | null = null;
let _cacheExpiresAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Retorna el prompt activo desde agent_prompts (agent_type='classifier').
 * Retorna null si no existe — la clasificación se omitirá sin error.
 */
async function getClassifierPrompt(): Promise<string | null> {
  if (_cachedPrompt && Date.now() < _cacheExpiresAt) {
    return _cachedPrompt;
  }

  const { data, error } = await supabase
    .from("agent_prompts")
    .select("content")
    .eq("agent_type", "classifier")
    .eq("is_active", true)
    .is("client_id", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.content) {
    logger.warn("No se encontró classifier prompt en agent_prompts — clasificación omitida", { error });
    return null;
  }

  _cachedPrompt = data.content as string;
  _cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  logger.debug("Classifier prompt cargado desde DB y cacheado");
  return _cachedPrompt;
}

// Retornado cuando el LLM falla o devuelve JSON inválido.
// Score 0 para no contaminar métricas con datos inventados.
const FALLBACK_CLASSIFICATION: Classification = {
  score: 0,
  classification: "cold",
  extracted: { need: null, customer_type: null, budget: null, timeline: null, productos_mencionados: [], objecciones_detectadas: [], venta_cruzada_oportunidad: false },
  reasoning: "fallback — clasificación no disponible",
};

// ---------------------------------------------------------------------------
// Función principal
// ---------------------------------------------------------------------------

/**
 * Clasifica el lead basándose en el historial completo de la conversación.
 * Usa temperatura=0 para resultados deterministas.
 * Nunca lanza excepción — retorna FALLBACK_CLASSIFICATION si algo falla.
 */
export async function classifyConversation(
  history: Message[]
): Promise<Classification> {
  if (history.length === 0) {
    logger.debug("Historial vacío, retornando clasificación cold");
    return { ...FALLBACK_CLASSIFICATION, reasoning: "historial vacío" };
  }

  const classifierPrompt = await getClassifierPrompt();
  if (!classifierPrompt) {
    return { ...FALLBACK_CLASSIFICATION, reasoning: "prompt no configurado en agent_prompts" };
  }

  const messages = [
    { role: "system", content: classifierPrompt },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    {
      role: "user" as const,
      content: "Basándote en toda la conversación anterior, clasifica este lead.",
    },
  ];

  const apiKey = resolveApiKey("openai");
  const authHeader = `Bearer ${apiKey}`;

  // raw declarado fuera del try para ser accesible en el catch (útil al logear fallos de JSON.parse)
  let raw = "";
  try {
    const response = await fetch(CLASSIFIER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authHeader,
      },
      body: JSON.stringify({
        model: CLASSIFIER_MODEL,
        messages,
        temperature: 0,       // Determinista — sin creatividad
        max_tokens: 400,
      }),
    });

    const data = await response.json();
    raw = data.choices?.[0]?.message?.content ?? "";

    if (!raw) {
      logger.warn("Respuesta vacía del Classifier Agent", { status: response.status });
      return FALLBACK_CLASSIFICATION;
    }

    // Algunos modelos envuelven el JSON en fences de markdown (```json ... ```)
    const cleaned = raw.trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/i, "");

    const classification = JSON.parse(cleaned) as Classification;
    logger.debug("Lead clasificado", {
      score: classification.score,
      classification: classification.classification,
      reasoning: classification.reasoning,
    });
    return classification;
  } catch (e) {
    logger.warn("Error en Classifier Agent, usando fallback", { error: String(e), raw });
    return FALLBACK_CLASSIFICATION;
  }
}
