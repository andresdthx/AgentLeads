// Vision service — uses OpenAI GPT-4o-mini to extract product information from images.
//
// Always calls OpenAI directly, regardless of the client's configured LLM plan.
// gpt-4o-mini is the cheapest vision-capable model (~$0.003 per image) and handles
// product catalog screenshots well.
//
// The vision prompt is loaded from agent_prompts (agent_type='vision', client_id=NULL).
// Falls back to a hardcoded prompt if the DB is unavailable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../utils/logger.ts";
import { isSafeMediaUrl, fetchWithTimeout } from "../utils/security.ts";

const logger = createLogger("vision");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const VISION_MODEL = "gpt-4o-mini";
const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

// Fallback hardcodeado — se usa solo si la DB falla
const VISION_PROMPT_FALLBACK =
  "Esta imagen fue enviada por un cliente interesado en productos. " +
  "Describe en una sola oración qué muestra: incluye marca, modelo, referencia, talla y color si son visibles. " +
  "Si es un pantallazo de catálogo o lista de precios, transcribe la información relevante del producto. " +
  "Si no contiene ningún producto identificable, responde exactamente: 'imagen sin producto identificable'.";

// Cache de módulo — persiste mientras la instancia Edge Function esté caliente
let _cachedVisionPrompt: string | null = null;

async function getVisionPrompt(): Promise<string> {
  if (_cachedVisionPrompt) return _cachedVisionPrompt;

  const { data, error } = await supabase
    .from("agent_prompts")
    .select("content")
    .eq("agent_type", "vision")
    .eq("is_active", true)
    .is("client_id", null)
    .single();

  if (error || !data?.content) {
    logger.warn("No se encontró vision prompt en DB, usando fallback hardcodeado", { error });
    return VISION_PROMPT_FALLBACK;
  }

  _cachedVisionPrompt = data.content as string;
  logger.debug("Vision prompt cargado desde DB y cacheado");
  return _cachedVisionPrompt;
}

/**
 * Describes a product image using OpenAI Vision.
 * Returns a natural-language description that flows into the rest of the pipeline
 * (intent agent, inventory lookup, LLM response) as if the user had typed it.
 */
export async function describeProductImage(imageUrl: string): Promise<string> {
  const apiKey =
    Deno.env.get("LLM_API_KEY_OPENAI") ?? Deno.env.get("LLM_API_KEY");

  if (!apiKey) {
    logger.error("API key de OpenAI no configurada para Vision");
    throw new Error("OpenAI API key not configured for vision");
  }

  // Protección SSRF: solo URLs HTTPS con hosts públicos
  if (!isSafeMediaUrl(imageUrl)) {
    logger.error("URL de imagen bloqueada por SSRF guard", { imageUrl });
    throw new Error("URL de imagen no permitida");
  }

  const visionPrompt = await getVisionPrompt();

  // Timeout 20 s para Vision API
  const response = await fetchWithTimeout(
    OPENAI_ENDPOINT,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: imageUrl },
              },
              {
                type: "text",
                text: visionPrompt,
              },
            ],
          },
        ],
        max_tokens: 200,
        temperature: 0,
      }),
    },
    20_000
  );

  if (!response.ok) {
    const err = await response.text();
    logger.error("Error en Vision API", { status: response.status, error: err });
    throw new Error(`Vision API error ${response.status}`);
  }

  const data = await response.json();
  const description: string =
    data.choices?.[0]?.message?.content?.trim() ?? "imagen enviada por el cliente";

  logger.debug("Imagen descrita", { imageUrl, description });
  return description;
}
