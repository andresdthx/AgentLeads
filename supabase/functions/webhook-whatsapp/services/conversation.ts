// Conversation service - handles message storage and history

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Message } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("conversation");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * Save a message to the database
 */
async function saveMessage(message: Message): Promise<void> {
  const { error } = await supabase.from("messages").insert(message);

  if (error) {
    logger.error("Error guardando mensaje", { role: message.role, leadId: message.lead_id, error });
    throw error;
  }
}

/**
 * Get conversation history for a lead
 */
export async function getConversationHistory(
  leadId: string,
  limit: number = 10
): Promise<Message[]> {
  const { data: history } = await supabase
    .from("messages")
    .select("lead_id, role, content")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (history || []).reverse();
}

/**
 * Get conversation history length for a lead
 */
export async function getConversationHistoryLength(
  leadId: string
): Promise<number> {
  const { count } = await supabase
    .from("messages")
    .select("lead_id", { count: "exact", head: true })
    .eq("lead_id", leadId)
    .eq("role", "user")

  return count || 0;
}

/**
 * Save incoming user message
 */
export async function saveUserMessage(
  leadId: string,
  content: string
): Promise<void> {
  await saveMessage({
    lead_id: leadId,
    role: "user",
    content,
  });
}

/**
 * Guarda la respuesta del bot y actualiza la clasificación del lead en una sola
 * transacción atómica usando la RPC save_bot_response (migración 028).
 *
 * Garantiza que mensaje + clasificación se persistan juntos o no se persista
 * ninguno, evitando el estado inconsistente: mensaje guardado pero lead sin
 * actualizar (o viceversa) en caso de fallo entre las dos escrituras.
 */
export async function saveBotResponse(
  leadId: string,
  content: string,
  classification?: {
    score: number;
    classification: string;
    extracted_data?: Record<string, unknown>;
    reasoning?: string;
  }
): Promise<void> {
  const { error } = await supabase.rpc("save_bot_response", {
    p_lead_id: leadId,
    p_content: content,
    p_score: classification?.score ?? null,
    p_classification: classification?.classification ?? null,
    p_extracted_data: classification?.extracted_data ? JSON.stringify(classification.extracted_data) : null,
    p_reasoning: classification?.reasoning ?? null,
  });

  if (error) {
    logger.error("Error en RPC save_bot_response", { leadId, error });
    throw error;
  }
}

