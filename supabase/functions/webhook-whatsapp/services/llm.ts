// LLM service - handles AI conversation and classification

import type { LLMMessage, OrderData, ReservationData, HandoffData, Message, ClientConfig, ClientFAQ } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("llm");

/**
 * Resolve API key for a given provider slug.
 * Looks for LLM_API_KEY_<PROVIDER> first, falls back to LLM_API_KEY.
 * Secrets deben estar configurados en Supabase Edge Function secrets.
 */
export function resolveApiKey(providerSlug: string): string {
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
 * Parse order data from LLM response.
 * Primary: detects a PEDIDO_INICIO ... PEDIDO_FIN block containing "pedido_confirmado": true.
 * Fallback: detects the purchase-redirect phrase when the LLM emitted the text
 *           but forgot to include the structured JSON block (prompt non-compliance).
 */
function parseOrderData(response: string): OrderData | null {
  const blockMatch = response.match(/PEDIDO_INICIO\s*([\s\S]*?)\s*PEDIDO_FIN/);

  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      if (parsed?.pedido_confirmado === true && Array.isArray(parsed?.items)) {
        return parsed as OrderData;
      }
    } catch (e) {
      logger.warn("Error parseando bloque de pedido", { error: e, raw: blockMatch[1] });
    }
  }

  // Fallback: the LLM wrote the compras-redirect message but skipped the JSON block.
  // Treat as a confirmed order with unknown item details so the lead is still paused
  // and classified as hot/100.
  const REDIRECT_PHRASE = /compañero de compras|paso con.*compras/i;
  if (REDIRECT_PHRASE.test(response)) {
    logger.warn("LLM redirigió a compras sin bloque PEDIDO_INICIO — creando orderData sintético");
    return {
      pedido_confirmado: true,
      ciudad_envio: null,
      tipo_cliente: null,
      items: [],
    };
  }

  return null;
}

/**
 * Parse reservation data from LLM response (RESERVA_INICIO...RESERVA_FIN block).
 * Used for service-based clients (e.g. Masajes S.A) that confirm bookings.
 */
function parseReservationData(response: string): ReservationData | null {
  const blockMatch = response.match(/RESERVA_INICIO\s*([\s\S]*?)\s*RESERVA_FIN/);

  if (blockMatch) {
    try {
      const parsed = JSON.parse(blockMatch[1].trim());
      if (parsed?.reserva_confirmada === true) {
        return parsed as ReservationData;
      }
    } catch (e) {
      logger.warn("Error parseando bloque de reserva", { error: e, raw: blockMatch[1] });
    }
  }

  return null;
}

/**
 * Parse handoff data from LLM response (HANDOFF_INICIO...HANDOFF_FIN block).
 * Generic command the LLM can emit from any client prompt to trigger human takeover.
 *
 * Format:
 *   HANDOFF_INICIO
 *   motivo: <free text reason>
 *   urgente: true|false
 *   HANDOFF_FIN
 *
 * Returns null if no valid block is found.
 */
function parseHandoffData(response: string): HandoffData | null {
  const blockMatch = response.match(/HANDOFF_INICIO\s*([\s\S]*?)\s*HANDOFF_FIN/);
  if (!blockMatch) return null;

  const block = blockMatch[1];
  const motivoMatch = block.match(/motivo:\s*(.+)/);
  const urgenteMatch = block.match(/urgente:\s*(true|false)/);

  if (!motivoMatch) return null;

  return {
    motivo: motivoMatch[1].trim(),
    urgente: urgenteMatch?.[1] === "true",
  };
}

/**
 * Build a FAQ prompt section to inject into the system prompt.
 * Only called when config.faqs has entries.
 */
function buildFaqSection(faqs: ClientFAQ[]): string {
  const entries = faqs
    .map((f) => `**P:** ${f.question}\n**R:** ${f.answer}`)
    .join("\n\n");
  return `## Preguntas Frecuentes\n\n${entries}`;
}

/**
 * Clean response by removing structured command blocks before sending to the customer.
 */
function cleanResponse(response: string): string {
  return response
    .replace(/PEDIDO_INICIO[\s\S]*?PEDIDO_FIN/, "")
    .replace(/RESERVA_INICIO[\s\S]*?RESERVA_FIN/, "")
    .replace(/HANDOFF_INICIO[\s\S]*?HANDOFF_FIN/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Generate LLM response (sales agent only — classification is handled separately).
 * @param inventorySection - Bloque de contexto de inventario a inyectar al system prompt (opcional).
 */
export async function generateResponse(
  history: Message[],
  config: ClientConfig,
  inventorySection?: string
): Promise<{ response: string; orderData: OrderData | null; reservationData: ReservationData | null; handoffData: HandoffData | null }> {
  // Build system prompt: base + FAQs (if any) + inventory/catalog context (if any).
  // If the base prompt contains {{SERVICIOS_INYECTADOS}}, replace it in-place so the
  // data lands inside the <ContextoNegocio> block where the prompt instructs the LLM to read it.
  // Otherwise append at the end (backward-compatible with all other clients).
  const PLACEHOLDER = "{{SERVICIOS_INYECTADOS}}";
  let basePrompt = config.system_prompt;
  if (inventorySection && basePrompt.includes(PLACEHOLDER)) {
    basePrompt = basePrompt.replace(PLACEHOLDER, inventorySection);
  }

  const sections: string[] = [basePrompt];
  if (config.faqs.length > 0)             sections.push(buildFaqSection(config.faqs));
  if (inventorySection && !config.system_prompt.includes(PLACEHOLDER)) sections.push(inventorySection);
  const systemPrompt = sections.join("\n\n");

  const messages = buildLLMMessages(history, systemPrompt);
  const llmResponse = await callLLM(messages, config);

  const orderData = parseOrderData(llmResponse);
  const reservationData = orderData ? null : parseReservationData(llmResponse);
  // Parse generic handoff command only when no order or reservation was confirmed.
  const handoffData = !orderData && !reservationData ? parseHandoffData(llmResponse) : null;
  const cleanedResponse = cleanResponse(llmResponse);

  return {
    response: cleanedResponse,
    orderData,
    reservationData,
    handoffData,
  };
}
