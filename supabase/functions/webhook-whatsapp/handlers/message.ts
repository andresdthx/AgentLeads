// Message handler - orchestrates the complete flow

import type { RequestPayload } from "../types/index.ts";
import { getOrCreateLead, updateLeadClassification, pauseLead } from "../services/lead.ts";
import {
  saveUserMessage,
  saveAssistantMessage,
  getConversationHistory,
} from "../services/conversation.ts";
import { generateResponse } from "../services/llm.ts";
import { sendWhatsAppMessage } from "../services/whatsapp.ts";
import { getClientConfig, getClientByChannelPhone } from "../services/client.ts";
import { hasProductKeywords, extractProductIntent } from "../services/intent.ts";
import { queryInventory, clientHasCatalog, buildInventorySection } from "../services/inventory.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("message-handler");

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
  const channelPhone = payload.channel_phone_number;
  const incomingMessage = payload.message?.text;

  // Ignore non-text messages (images, audio, etc)
  if (!phone || !incomingMessage || !channelPhone) {
    return { ok: true, skipped: true, reason: "missing required data" };
  }

  logger.info("Mensaje entrante", { phone, channelPhone, message: incomingMessage });

  // 1. Find client by channel phone number
  const client = await getClientByChannelPhone(channelPhone);

  if (!client) {
    logger.error("Canal sin cliente configurado", { channelPhone });
    return {
      ok: false,
      skipped: true,
      reason: `No client configured for channel ${channelPhone}`
    };
  }

  logger.info("Cliente identificado", { clientId: client.id, clientName: client.name });

  // 2. Get or create lead with the correct client_id
  const lead = await getOrCreateLead(phone, client.id);

  // 3. Si el bot está pausado, no procesar — humano en control
  if (lead.bot_paused) {
    logger.info("Bot pausado, mensaje ignorado por el agente", {
      leadId: lead.id,
      reason: lead.bot_paused_reason,
    });
    return { ok: true, skipped: true, reason: "bot_paused" };
  }

  // 4. Get client configuration
  const clientConfig = await getClientConfig(client.id);

  // 5. Save incoming message
  await saveUserMessage(lead.id, incomingMessage);

  // 6. Get conversation history with client's limit
  const history = await getConversationHistory(
    lead.id,
    clientConfig.conversation_history_limit
  );

  // 7. Intent Agent — detectar si el mensaje involucra productos
  let inventorySection = "";

  if (hasProductKeywords(incomingMessage)) {
    logger.debug("Palabras clave de producto detectadas, activando Intent Agent");

    const intent = await extractProductIntent(history, clientConfig);
    logger.debug("Intent extraído", { intent });

    if (intent.has_product_intent) {
      // 7a. Verificar si el cliente tiene catálogo configurado
      const hasCatalog = await clientHasCatalog(client.id);

      if (!hasCatalog) {
        logger.info("Sin catálogo configurado, bot pausado", { leadId: lead.id });
        await pauseLead(lead.id, "no_catalog");
        return { ok: true, skipped: true, reason: "bot_paused:no_catalog" };
      }

      // 7b. El cliente pide imágenes explícitamente → pausar para envío manual
      if (intent.needs_images) {
        logger.info("Cliente solicita imágenes, bot pausado", { leadId: lead.id });
        await pauseLead(lead.id, "needs_images");
        await sendWhatsAppMessage(
          phone,
          "Enseguida te paso las fotos. Un asesor te atenderá en un momento. 📸"
        );
        return { ok: true, skipped: true, reason: "bot_paused:needs_images" };
      }

      // 7c. Consultar inventario y construir contexto
      const products = await queryInventory(client.id, intent);

      if (products.length === 0) {
        logger.info("Sin stock para la consulta, bot pausado", { leadId: lead.id, intent });
        await pauseLead(lead.id, "out_of_stock");
        await sendWhatsAppMessage(
          phone,
          "Déjame verificar disponibilidad. Un asesor te confirma en breve. 🔍"
        );
        return { ok: true, skipped: true, reason: "bot_paused:out_of_stock" };
      }

      // 7d. Hay productos → construir sección de inventario para inyectar al LLM
      inventorySection = buildInventorySection(products);
      logger.debug("Contexto de inventario construido", { products: products.length });
    }
  }

  // 8. Generate LLM response — inyectar inventario si existe
  const { response, classification } = await generateResponse(
    history,
    clientConfig,
    inventorySection || undefined
  );

  // 9. Update lead classification if present
  if (classification) {
    await updateLeadClassification(lead.id, classification);
    logger.info("Lead clasificado", {
      phone,
      leadId: lead.id,
      classification: classification.classification,
      score: classification.score,
    });
  }

  // 10. Save assistant response
  await saveAssistantMessage(lead.id, response);

  // 11. Send response via WhatsApp
  await sendWhatsAppMessage(phone, response);

  return { ok: true };
}
