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
export async function saveMessage(message: Message): Promise<void> {
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
    .select("role, content")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  return (history || []).reverse();
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
 * Save assistant response message
 */
export async function saveAssistantMessage(
  leadId: string,
  content: string
): Promise<void> {
  await saveMessage({
    lead_id: leadId,
    role: "assistant",
    content,
  });
}

/**
 * Save a synthetic handoff note into conversation history.
 * Called by resumeLead so the LLM has context when it takes over again.
 */
export async function saveHandoffNote(leadId: string): Promise<void> {
  await saveMessage({
    lead_id: leadId,
    role: "assistant",
    content:
      "[NOTA INTERNA: El bot estuvo pausado mientras un asesor humano atendía esta conversación. Continúa de forma natural desde donde quedó el cliente.]",
  });
}
