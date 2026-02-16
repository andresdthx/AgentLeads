// Conversation service - handles message storage and history

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Message } from "../types/index.ts";
import { CONVERSATION_HISTORY_LIMIT } from "../config/prompts.ts";

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
    console.error("Error guardando mensaje:", error);
    throw error;
  }
}

/**
 * Get conversation history for a lead
 */
export async function getConversationHistory(
  leadId: string,
  limit: number = CONVERSATION_HISTORY_LIMIT
): Promise<Message[]> {
  const { data: history } = await supabase
    .from("messages")
    .select("role, content")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: true })
    .limit(limit);

  return history || [];
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
