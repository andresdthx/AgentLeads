// Vision service — uses OpenAI GPT-4o-mini to extract product information from images.
//
// Always calls OpenAI directly, regardless of the client's configured LLM plan.
// gpt-4o-mini is the cheapest vision-capable model (~$0.003 per image) and handles
// product catalog screenshots well.
//
// The vision prompt is loaded from agent_prompts (agent_type='vision', client_id=NULL).
// Falls back to a hardcoded prompt if the DB is unavailable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { VisionResult, VisionProductData } from "../types/index.ts";
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
  'Analiza esta imagen enviada por un cliente interesado en comprar un producto.\n' +
  'Responde ÚNICAMENTE con JSON válido, sin texto adicional, en uno de estos formatos:\n' +
  '1. Producto identificable: {"type":"product","name":"","brand":null,"reference":null,"attributes":null,"price_detal":null,"price_mayorista":null,"confidence":"high"}\n' +
  '   confidence: "high"=info completa visible, "medium"=producto reconocible sin texto, "low"=imagen ambigua\n' +
  '2. Catálogo con múltiples productos: {"type":"catalog","products":[{"name":"","reference":null,"attributes":null,"price_detal":null,"price_mayorista":null}]}\n' +
  '3. Sin producto identificable: {"type":"no_product"}';

// Cache con TTL — se invalida cada 5 min para que cambios en agent_prompts se reflejen sin reiniciar
let _cachedVisionPrompt: string | null = null;
let _visionCacheExpiresAt = 0;
const VISION_CACHE_TTL_MS = 5 * 60 * 1000;

async function getVisionPrompt(): Promise<string> {
  if (_cachedVisionPrompt && Date.now() < _visionCacheExpiresAt) return _cachedVisionPrompt;

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
  _visionCacheExpiresAt = Date.now() + VISION_CACHE_TTL_MS;
  logger.debug("Vision prompt cargado desde DB y cacheado");
  return _cachedVisionPrompt;
}

/**
 * Analyzes a product image using OpenAI Vision.
 * Returns a structured VisionResult with type, confidence, and extracted product fields.
 * The caller uses confidence to decide: use directly (high), search catalog (medium), or handoff (low).
 */
export async function describeProductImage(imageUrl: string): Promise<VisionResult> {
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
        max_tokens: 400,
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
  const raw: string = data.choices?.[0]?.message?.content?.trim() ?? "";

  const result = parseVisionResponse(raw);
  logger.debug("Imagen analizada", { imageUrl, type: result.type, confidence: (result as Record<string, unknown>).confidence });
  return result;
}

/**
 * Converts a Vision API `attributes` value to a flat string.
 * GPT may return attributes as a plain string or as a JSON object like
 * {"color":"rosa","material":"silicona"}. String() on an object produces
 * "[object Object]", so we extract the values manually.
 */
function flattenAttributes(val: unknown): string | null {
  if (!val) return null;
  if (typeof val === "string") return val.trim() || null;
  if (Array.isArray(val)) return val.filter(Boolean).map(String).join(" ").trim() || null;
  if (typeof val === "object") {
    return Object.values(val as Record<string, unknown>)
      .filter(Boolean)
      .map(String)
      .join(" ")
      .trim() || null;
  }
  return String(val) || null;
}

/**
 * Parses the raw string from Vision API into a VisionResult.
 * Handles JSON responses from the new prompt and plain-text from the old prompt as fallback.
 */
function parseVisionResponse(raw: string): VisionResult {
  if (!raw) return { type: "no_product" };

  // Try JSON parse first (new prompt format)
  try {
    // Strip markdown code fences if present (```json ... ```)
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    // deno-lint-ignore no-explicit-any
    const parsed: any = JSON.parse(cleaned);

    if (parsed.type === "no_product") {
      return { type: "no_product" };
    }

    if (parsed.type === "catalog" && Array.isArray(parsed.products)) {
      const products: VisionProductData[] = parsed.products.map((p: Record<string, unknown>) => ({
        name:            String(p.name ?? ""),
        brand:           p.brand           ? String(p.brand)           : null,
        reference:       p.reference       ? String(p.reference)       : null,
        attributes:      flattenAttributes(p.attributes),
        price_detal:     p.price_detal     ? String(p.price_detal)     : null,
        price_mayorista: p.price_mayorista ? String(p.price_mayorista) : null,
      }));
      return { type: "catalog", products };
    }

    if (parsed.type === "product" && parsed.name) {
      return {
        type:            "product",
        name:            String(parsed.name),
        brand:           parsed.brand           ? String(parsed.brand)           : null,
        reference:       parsed.reference       ? String(parsed.reference)       : null,
        attributes:      flattenAttributes(parsed.attributes),
        price_detal:     parsed.price_detal     ? String(parsed.price_detal)     : null,
        price_mayorista: parsed.price_mayorista ? String(parsed.price_mayorista) : null,
        confidence:      ["high", "medium", "low"].includes(parsed.confidence) ? parsed.confidence : "medium",
      };
    }
  } catch {
    // Not JSON — fall through to legacy plain-text handling
  }

  // Legacy fallback: old prompt returned plain text
  if (raw.toLowerCase().includes("imagen sin producto identificable")) {
    return { type: "no_product" };
  }

  // Wrap free-text description as medium-confidence product
  return {
    type:            "product",
    name:            raw.slice(0, 200),
    brand:           null,
    reference:       null,
    attributes:      null,
    price_detal:     null,
    price_mayorista: null,
    confidence:      "medium",
  };
}
