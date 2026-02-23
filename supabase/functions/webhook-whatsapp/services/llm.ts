// LLM service - handles AI conversation and classification

import type { LLMMessage, Classification, OrderData, Message, ClientConfig } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("llm");

/**
 * Resolve API key for a given provider slug.
 * Looks for LLM_API_KEY_<PROVIDER> first, falls back to LLM_API_KEY.
 * Secrets deben estar configurados en Supabase Edge Function secrets.
 */
function resolveApiKey(providerSlug: string): string {
  const key = Deno.env.get(`LLM_API_KEY_${providerSlug.toUpperCase()}`);
  if (key) return key;
  const fallback = Deno.env.get("LLM_API_KEY");
  if (fallback) return fallback;
  throw new Error(`No API key found for provider: ${providerSlug}`);
}

/**
 * Build messages array for LLM
 */
function buildLLMMessages(
  history: Message[],
  systemPrompt: string
): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: "system", content: systemPrompt },
  ];

  history.forEach((msg) => {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  });

  return messages;
}

/**
 * Call LLM provider
 */
async function callLLM(
  messages: LLMMessage[],
  config: ClientConfig
): Promise<string> {
  logger.debug("Enviando al LLM", {
    provider: config.llm.provider_slug,
    model: config.llm.model_id,
    plan: config.plan_name,
    total_messages: messages.length,
    messages,
  });

  const apiKey = resolveApiKey(config.llm.provider_slug);
  const authHeader = config.llm.api_key_prefix
    ? `${config.llm.api_key_prefix} ${apiKey}`
    : apiKey;

  const response = await fetch(config.llm.chat_endpoint_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [config.llm.api_key_header]: authHeader,
    },
    body: JSON.stringify({
      model: config.llm.model_id,
      messages,
      temperature: config.llm_temperature,
    }),
  });

  const data = await response.json();

  if (!data.choices?.[0]?.message?.content) {
    logger.error("Respuesta inválida del LLM", { status: response.status, data });
    throw new Error("No response from LLM");
  }

  logger.debug("Respuesta recibida del LLM", {
    model: config.llm.model_id,
    finish_reason: data.choices?.[0]?.finish_reason,
    usage: data.usage,
  });

  return data.choices[0].message.content;
}

/**
 * Parse classification from LLM response
 */
function parseClassification(response: string): Classification | null {
  const classMatch = response.match(/CLASIFICACION([\s\S]*)FIN/);

  if (!classMatch) {
    return null;
  }

  try {
    return JSON.parse(classMatch[1].trim());
  } catch (e) {
    logger.warn("Error parseando bloque de clasificación", { error: e, raw: classMatch[1] });
    return null;
  }
}

/**
 * Parse order data from LLM response.
 * Detects a ```json ... ``` block containing "pedido_confirmado": true.
 */
function parseOrderData(response: string): OrderData | null {
  const blockMatch = response.match(/```json\s*([\s\S]*?)```/);

  if (!blockMatch) return null;

  try {
    const parsed = JSON.parse(blockMatch[1].trim());
    if (parsed?.pedido_confirmado === true && Array.isArray(parsed?.items)) {
      return parsed as OrderData;
    }
    return null;
  } catch (e) {
    logger.warn("Error parseando bloque de pedido", { error: e, raw: blockMatch[1] });
    return null;
  }
}

/**
 * Clean response by removing classification block and order JSON block
 */
function cleanResponse(response: string): string {
  return response
    .replace(/CLASIFICACION[\s\S]*FIN/, "")
    .replace(/```json[\s\S]*?```/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Generate LLM response and extract classification if present.
 * @param inventorySection - Bloque de contexto de inventario a inyectar al system prompt (opcional).
 */
export async function generateResponse(
  history: Message[],
  config: ClientConfig,
  inventorySection?: string
): Promise<{ response: string; classification: Classification | null; orderData: OrderData | null }> {
  const systemPrompt = inventorySection
    ? `${config.system_prompt}\n\n${inventorySection}`
    : config.system_prompt;

  const messages = buildLLMMessages(history, systemPrompt);
  const llmResponse = await callLLM(messages, config);

  const classification = parseClassification(llmResponse);
  const orderData = parseOrderData(llmResponse);
  const cleanedResponse = cleanResponse(llmResponse);

  return {
    response: cleanedResponse,
    classification,
    orderData,
  };
}
