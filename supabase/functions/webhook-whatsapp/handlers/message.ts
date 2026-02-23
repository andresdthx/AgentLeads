// Message handler — orchestrates the complete flow.
//
// Receives a provider-agnostic NormalizedMessage and a WhatsAppProvider.
// No direct coupling to 2chat or WA Business API payload formats.

import type { NormalizedMessage, WhatsAppProvider } from "../types/index.ts";
import { getOrCreateLead, updateLeadClassification, saveOrderData, pauseLead } from "../services/lead.ts";
import {
  saveUserMessage,
  saveAssistantMessage,
  getConversationHistory,
} from "../services/conversation.ts";
import { generateResponse } from "../services/llm.ts";
import { getClientConfig, getClientByChannelPhone } from "../services/client.ts";
import { hasProductKeywords, extractProductIntent } from "../services/intent.ts";
import { queryInventory, clientHasCatalog, buildInventorySection, buildCatalogSection } from "../services/inventory.ts";
import { enqueueAndDebounce } from "../services/messageQueue.ts";
import { describeProductImage } from "../services/vision.ts";
import { transcribeAudio } from "../services/audio.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("message-handler");

/**
 * Process an incoming WhatsApp message.
 * The adapter in index.ts is responsible for normalizing the raw webhook payload
 * before calling this function.
 */
export async function handleIncomingMessage(
  msg: NormalizedMessage,
  provider: WhatsAppProvider
): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  const phone = msg.phone;
  const channelPhone = msg.channelPhone;
  const incomingText = msg.text;
  const incomingMedia = msg.media;

  const messageType = incomingText ? "text" : (incomingMedia?.type ?? "unknown");
  logger.info("Mensaje entrante", { phone, channelPhone, type: messageType });

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

  // 4. Resolver texto del mensaje — si es imagen/audio, llamar API correspondiente
  let incomingMessage: string;
  if (incomingText) {
    incomingMessage = incomingText;
  } else if (incomingMedia?.type === "image") {
    logger.info("Imagen recibida, procesando con Vision API", { phone, url: incomingMedia.url });
    incomingMessage = await describeProductImage(incomingMedia.url);
    logger.info("Imagen procesada", { phone, description: incomingMessage });
  } else if (incomingMedia?.type === "audio") {
    // "ptt" (push-to-talk) is normalized to "audio" by the adapter
    logger.info("Audio recibido, transcribiendo con Whisper", { phone, url: incomingMedia.url, mime: incomingMedia.mimeType });
    incomingMessage = await transcribeAudio(incomingMedia.url, incomingMedia.mimeType);
    logger.info("Audio transcrito", { phone, transcription: incomingMessage });
  } else {
    // Video, documento — no soportado aún
    logger.debug("Tipo de media no soportado, ignorando", { phone, type: incomingMedia?.type });
    return { ok: true, skipped: true, reason: `unsupported media type: ${incomingMedia?.type}` };
  }

  // 5. Debounce: agrupar mensajes rápidos del mismo lead
  // Espera 3 s; si llegó un mensaje más nuevo para este phone, sale sin procesar.
  const batchMessages = await enqueueAndDebounce(phone, channelPhone, incomingMessage);

  if (batchMessages === null) {
    logger.debug("Mensaje agrupado en lote de otro mensaje más reciente", { phone });
    return { ok: true, skipped: true, reason: "debounced" };
  }

  logger.info("Procesando lote de mensajes", { phone, count: batchMessages.length });

  // 6. Get client configuration
  const clientConfig = await getClientConfig(client.id);

  // 7. Save all messages in the batch to conversation history (in order)
  for (const msgText of batchMessages) {
    await saveUserMessage(lead.id, msgText);
  }

  // Combined text for intent detection (all messages joined)
  const combinedMessage = batchMessages.join("\n");

  // 8. Get conversation history with client's limit
  const history = await getConversationHistory(
    lead.id,
    clientConfig.conversation_history_limit
  );

  // 9. Contexto de productos — catálogo siempre presente; inventario solo si hay intent
  let inventorySection = "";

  if (client.product_mode === "catalog") {
    // 9a. Modo catálogo — inyectar URL en cada mensaje; el LLM decide cuándo compartirla
    if (!client.catalog_url) {
      logger.info("Sin URL de catálogo configurada, bot pausado", { leadId: lead.id });
      await pauseLead(lead.id, "no_catalog");
      return { ok: true, skipped: true, reason: "bot_paused:no_catalog" };
    }
    inventorySection = buildCatalogSection(client.catalog_url);
    logger.debug("Contexto de catálogo construido", { catalogUrl: client.catalog_url });

  } else if (hasProductKeywords(combinedMessage)) {
    // 9b. Modo inventario — activar Intent Agent solo si hay palabras clave de producto
    logger.debug("Palabras clave de producto detectadas, activando Intent Agent");

    const intent = await extractProductIntent(history, clientConfig);
    logger.debug("Intent extraído", { intent });

    if (intent.has_product_intent) {
      const hasCatalog = await clientHasCatalog(client.id);

      if (!hasCatalog) {
        logger.info("Sin productos en inventario, bot pausado", { leadId: lead.id });
        await pauseLead(lead.id, "no_catalog");
        return { ok: true, skipped: true, reason: "bot_paused:no_catalog" };
      }

      // 9c. El cliente pide imágenes explícitamente → pausar para envío manual
      if (intent.needs_images) {
        logger.info("Cliente solicita imágenes, bot pausado", { leadId: lead.id });
        await pauseLead(lead.id, "needs_images");
        await provider.sendMessage(
          phone,
          "Enseguida te paso las fotos. Un asesor te atenderá en un momento. 📸"
        );
        return { ok: true, skipped: true, reason: "bot_paused:needs_images" };
      }

      // 9d. Consultar inventario y construir contexto
      const products = await queryInventory(client.id, intent);

      if (products.length === 0) {
        logger.info("Sin stock para la consulta, bot pausado", { leadId: lead.id, intent });
        await pauseLead(lead.id, "out_of_stock");
        await provider.sendMessage(
          phone,
          "Déjame verificar disponibilidad. Un asesor te confirma en breve. 🔍"
        );
        return { ok: true, skipped: true, reason: "bot_paused:out_of_stock" };
      }

      // 9e. Hay productos → construir sección de inventario para inyectar al LLM
      inventorySection = buildInventorySection(products);
      logger.debug("Contexto de inventario construido", { products: products.length });
    }
  }

  // 10. Generate LLM response — inyectar inventario si existe
  const { response, classification, orderData } = await generateResponse(
    history,
    clientConfig,
    inventorySection || undefined
  );

  // 11. Update lead classification if present
  if (classification) {
    await updateLeadClassification(lead.id, classification);
    logger.info("Lead clasificado", {
      phone,
      leadId: lead.id,
      classification: classification.classification,
      score: classification.score,
    });
  }

  // 12. Save assistant response
  await saveAssistantMessage(lead.id, response);

  // 13. Send response via WhatsApp
  await provider.sendMessage(phone, response);

  // 14. Si hay pedido confirmado → guardar en lead y pausar bot para el humano
  if (orderData) {
    await saveOrderData(lead.id, orderData);
    await pauseLead(lead.id, "order_confirmed");
    logger.info("Pedido confirmado — bot pausado, humano en control", {
      phone,
      leadId: lead.id,
      orderData,
    });
  }

  return { ok: true };
}
