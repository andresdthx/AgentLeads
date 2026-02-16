// Message handler - orchestrates the complete flow

import type { RequestPayload } from "../types/index.ts";
import { getOrCreateLead, updateLeadClassification } from "../services/lead.ts";
import {
  saveUserMessage,
  saveAssistantMessage,
  getConversationHistory,
} from "../services/conversation.ts";
import { generateResponse } from "../services/llm.ts";
import { sendWhatsAppMessage } from "../services/whatsapp.ts";

/**
 * Process incoming WhatsApp message
 */
export async function handleIncomingMessage(
  payload: RequestPayload
): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  // Ignore messages sent by us (avoid loop)
  if (payload.sent_by !== "user") {
    return { ok: true, skipped: true, reason: "not from user" };
  }

  const phone = payload.remote_phone_number;
  const incomingMessage = payload.message?.text;

  // Ignore non-text messages (images, audio, etc)
  if (!phone || !incomingMessage) {
    return { ok: true, skipped: true, reason: "no text" };
  }

  console.log(`Mensaje de ${phone}: ${incomingMessage}`);

  // 1. Get or create lead
  const lead = await getOrCreateLead(
    phone,
    payload.contact?.first_name
  );

  // 2. Save incoming message
  await saveUserMessage(lead.id, incomingMessage);

  // 3. Get conversation history
  const history = await getConversationHistory(lead.id);

  // 4. Generate LLM response
  const { response, classification } = await generateResponse(history);

  // 5. Update lead classification if present
  if (classification) {
    await updateLeadClassification(lead.id, classification);
    console.log(`Lead ${phone} clasificado: ${classification.classification} (${classification.score})`);
  }

  // 6. Save assistant response
  await saveAssistantMessage(lead.id, response);

  // 7. Send response via WhatsApp
  await sendWhatsAppMessage(phone, response);

  return { ok: true };
}
