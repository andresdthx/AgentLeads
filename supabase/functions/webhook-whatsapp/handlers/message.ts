// Message handler — orchestrates the complete flow.
//
// Receives a provider-agnostic NormalizedMessage and a WhatsAppProvider.
// No direct coupling to 2chat or WA Business API payload formats.
//
// Estructura del archivo:
//   1. Funciones de pipeline (resolveMessageText, buildProductContext, persistAndRespond)
//   2. Orquestador principal (handleIncomingMessage)
//
// Cada función de pipeline tiene una sola responsabilidad. El orquestador
// solo toma decisiones de alto nivel y delega la ejecución a los pipelines.

import type { NormalizedMessage, WhatsAppProvider, Lead, Client, ClientConfig, OrderData, Message, Classification } from "../types/index.ts";

import { getOrCreateLead, saveOrderData, pauseLead } from "../services/lead.ts";
import { classifyConversation } from "../services/classifier.ts";
import {
  saveUserMessage,
  saveBotResponse,
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

// ---------------------------------------------------------------------------
// Pipeline: resolución de texto
// ---------------------------------------------------------------------------
// Convierte cualquier tipo de mensaje (texto, imagen, audio) en texto plano.
// Retorna null si el tipo de media no está soportado.

async function resolveMessageText(
  msg: NormalizedMessage
): Promise<string | null> {
  const { text: incomingText, media: incomingMedia, phone } = msg;

  if (incomingText && incomingMedia?.type === "image") {
    logger.info("Imagen con texto recibida, procesando con Vision API", { phone, url: incomingMedia.url });
    const imageDescription = await describeProductImage(incomingMedia.url);
    logger.info("Imagen con texto procesada", { phone, text: incomingText, description: imageDescription });
    return `${incomingText}\n[Imagen adjunta: ${imageDescription}]`;
  }

  if (incomingText) {
    return incomingText;
  }

  if (incomingMedia?.type === "image") {
    logger.info("Imagen recibida, procesando con Vision API", { phone, url: incomingMedia.url });
    const description = await describeProductImage(incomingMedia.url);
    logger.info("Imagen procesada", { phone, description });
    return description;
  }

  if (incomingMedia?.type === "audio") {
    logger.info("Audio recibido, transcribiendo con Whisper", { phone, url: incomingMedia.url, mime: incomingMedia.mimeType });
    const transcription = await transcribeAudio(incomingMedia.url, incomingMedia.mimeType);
    logger.info("Audio transcrito", { phone, transcription });
    return transcription;
  }

  // Video, documento — no soportado aún
  logger.debug("Tipo de media no soportado, ignorando", { phone, type: incomingMedia?.type });
  return null;
}

// ---------------------------------------------------------------------------
// Pipeline: contexto de producto
// ---------------------------------------------------------------------------
// Decide si inyectar contexto de catálogo o inventario al LLM según product_mode.
// Retorna el bloque de contexto y los datos de intent extraídos (si aplica).
// Puede pausar el bot y retornar una señal de "pausa" al orquestador.

type ProductContextResult =
  | { paused: true; reason: string }
  | { paused: false; inventorySection: string; productIntentData?: Record<string, unknown> };

async function buildProductContext(
  client: Client,
  combinedMessage: string,
  history: Message[],
  clientConfig: ClientConfig,
  lead: Lead,
  phone: string,
  provider: WhatsAppProvider
): Promise<ProductContextResult> {
  if (client.product_mode === "catalog") {
    if (!client.catalog_url) {
      logger.info("Sin URL de catálogo configurada, bot pausado", { leadId: lead.id });
      await pauseLead(lead.id, "no_catalog");
      return { paused: true, reason: "bot_paused:no_catalog" };
    }
    const inventorySection = buildCatalogSection(client.catalog_url);
    logger.debug("Contexto de catálogo construido", { catalogUrl: client.catalog_url });
    return { paused: false, inventorySection };
  }

  if (!hasProductKeywords(combinedMessage)) {
    return { paused: false, inventorySection: "" };
  }

  logger.debug("Palabras clave de producto detectadas, activando Intent Agent");
  const intent = await extractProductIntent(history, clientConfig);
  logger.debug("Intent extraído", { intent });

  if (!intent.has_product_intent) {
    return { paused: false, inventorySection: "" };
  }

  const productIntentData: Record<string, unknown> = {
    product_intent: {
      brand: intent.brand,
      model: intent.model,
      customer_type: intent.customer_type,
      confidence: intent.confidence,
    },
  };

  const hasCatalog = await clientHasCatalog(client.id);
  if (!hasCatalog) {
    logger.info("Sin productos en inventario, bot pausado", { leadId: lead.id });
    await pauseLead(lead.id, "no_catalog");
    return { paused: true, reason: "bot_paused:no_catalog" };
  }

  if (intent.needs_images) {
    logger.info("Cliente solicita imágenes, bot pausado", { leadId: lead.id });
    await pauseLead(lead.id, "needs_images");
    await provider.sendMessage(phone, "Enseguida te paso las fotos. Un asesor te atenderá en un momento. 📸");
    return { paused: true, reason: "bot_paused:needs_images" };
  }

  const products = await queryInventory(client.id, intent);
  if (products.length === 0) {
    logger.info("Sin stock para la consulta, bot pausado", { leadId: lead.id, intent });
    await pauseLead(lead.id, "out_of_stock");
    await provider.sendMessage(phone, "Déjame verificar disponibilidad. Un asesor te confirma en breve. 🔍");
    return { paused: true, reason: "bot_paused:out_of_stock" };
  }

  const inventorySection = buildInventorySection(products);
  logger.debug("Contexto de inventario construido", { products: products.length });
  return { paused: false, inventorySection, productIntentData };
}

// ---------------------------------------------------------------------------
// Pipeline: persistir y enviar respuesta
// ---------------------------------------------------------------------------
// Recibe la clasificación (puede ser null si fue omitida por maybeClassify) y
// escribe mensaje + clasificación en una sola RPC atómica antes de enviar al cliente.

async function persistAndRespond(
  lead: Lead,
  phone: string,
  response: string,
  orderData: OrderData | null,
  provider: WhatsAppProvider,
  classification: Classification | null,
  productIntentData: Record<string, unknown> | undefined
): Promise<void> {
  // Construir payload de clasificación para la RPC (si aplica).
  // productIntentData ya tiene la forma { product_intent: {...} } — no re-envolver.
  const classificationPayload = classification ? {
    score: classification.score,
    classification: classification.classification,
    extracted_data: {
      ...classification.extracted,
      ...(productIntentData ?? {}),
    },
    reasoning: classification.reasoning,
  } : undefined;

  // Transacción atómica: insertar mensaje + actualizar clasificación del lead en una sola RPC.
  await saveBotResponse(lead.id, response, classificationPayload);

  // Enviar al cliente (llamada externa — fuera de la transacción)
  await provider.sendMessage(phone, response);

  if (orderData) {
    await saveOrderData(lead.id, orderData);
    await pauseLead(lead.id, "order_confirmed");
    logger.info("Pedido confirmado — bot pausado, humano en control", {
      phone,
      leadId: lead.id,
      orderData,
    });
  }
}

// ---------------------------------------------------------------------------
// Pipeline: clasificación del lead (agente independiente)
// ---------------------------------------------------------------------------
// Se ejecuta DESPUÉS de enviar la respuesta al cliente.
// Nunca lanza excepción — un fallo de clasificación no afecta al usuario.
// Usa un LLM separado con temperatura=0 sin rol conversacional.

const CLASSIFY_MIN_MESSAGES = 3;  // mínimo de mensajes del usuario antes de la primera clasificación
const CLASSIFY_EVERY_N = 3;        // clasificar cada N mensajes del usuario

/**
 * Evalúa si corresponde clasificar en este turno y, si sí, llama al classifier.
 * Retorna null cuando la clasificación se omite (lead hot, contexto insuficiente o
 * no es el turno correspondiente según la frecuencia configurada).
 * Nunca lanza excepción — un fallo devuelve null para no bloquear el flujo principal.
 * La escritura a DB la realiza persistAndRespond via la RPC atómica save_bot_response.
 */
async function maybeClassify(
  leadId: string,
  history: Message[],
  config: ClientConfig,
  phone: string,
  currentClassification: Lead["classification"]
): Promise<Classification | null> {
  // Lead ya es hot: la clasificación alcanzó su objetivo, no tiene sentido re-evaluar.
  if (currentClassification === "hot") {
    logger.debug("Clasificación omitida: lead ya es hot", { leadId, phone });
    return null;
  }

  // Historial insuficiente: con menos de N mensajes del usuario no hay contexto real.
  const userMessageCount = history.filter((m) => m.role === "user").length;
  if (userMessageCount < CLASSIFY_MIN_MESSAGES) {
    logger.debug("Clasificación omitida: contexto insuficiente", { leadId, phone, userMessageCount });
    return null;
  }

  // Frecuencia: clasificar solo en cada múltiplo de CLASSIFY_EVERY_N mensajes del usuario.
  if (userMessageCount % CLASSIFY_EVERY_N !== 0) {
    logger.debug("Clasificación pospuesta", { leadId, phone, userMessageCount, next: CLASSIFY_EVERY_N - (userMessageCount % CLASSIFY_EVERY_N) });
    return null;
  }

  try {
    const result = await classifyConversation(history, config);
    logger.info("Lead clasificado", {
      phone,
      leadId,
      classification: result.classification,
      score: result.score,
      reasoning: result.reasoning,
    });
    return result;
  } catch (e) {
    logger.error("Error en classifier — se omite sin afectar al cliente", { leadId, phone, error: String(e) });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Orquestador principal
// ---------------------------------------------------------------------------
// Solo toma decisiones de alto nivel: qué hacer en cada etapa.
// La ejecución está delegada a los pipelines de arriba.

/**
 * Process an incoming WhatsApp message.
 * The adapter in index.ts is responsible for normalizing the raw webhook payload
 * before calling this function.
 */
export async function handleIncomingMessage(
  msg: NormalizedMessage,
  provider: WhatsAppProvider
): Promise<{ ok: boolean; skipped?: boolean; reason?: string }> {
  const { phone, channelPhone, text: incomingText, media: incomingMedia } = msg;
  const messageType = incomingText ? "text" : (incomingMedia?.type ?? "unknown");
  logger.info("Mensaje entrante", { phone, channelPhone, type: messageType });

  // 1. Identificar cliente por número de canal
  const client = await getClientByChannelPhone(channelPhone);
  if (!client) {
    logger.error("Canal sin cliente configurado", { channelPhone });
    return { ok: false, skipped: true, reason: `No client configured for channel ${channelPhone}` };
  }
  logger.info("Cliente identificado", { clientId: client.id, clientName: client.name });

  // 2. Obtener o crear lead
  const lead = await getOrCreateLead(phone, client.id);

  // 3. Modo observador — bot pausado: guardar mensaje y salir sin responder
  if (lead.bot_paused) {
    const observerContent = incomingText ?? (incomingMedia ? `[${incomingMedia.type} recibido]` : "[mensaje]");
    await saveUserMessage(lead.id, observerContent);
    logger.info("Modo observador: mensaje guardado sin respuesta del bot", {
      leadId: lead.id,
      reason: lead.bot_paused_reason,
    });
    return { ok: true, skipped: true, reason: "bot_paused" };
  }

  // 4. Resolver el mensaje a texto (imagen → Vision API, audio → Whisper, etc.)
  const incomingMessage = await resolveMessageText(msg);
  if (incomingMessage === null) {
    return { ok: true, skipped: true, reason: `unsupported media type: ${incomingMedia?.type}` };
  }

  // 5. Debounce: agrupar mensajes rápidos del mismo lead
  const batchMessages = await enqueueAndDebounce(phone, channelPhone, incomingMessage);
  if (batchMessages === null) {
    logger.debug("Mensaje agrupado en lote de otro mensaje más reciente", { phone });
    return { ok: true, skipped: true, reason: "debounced" };
  }
  logger.info("Procesando lote de mensajes", { phone, count: batchMessages.length });

  // 6. Configuración del cliente (cacheada en memoria)
  const clientConfig = await getClientConfig(client.id);

  // 6b. Sustituir placeholder [URL] del catálogo en el system prompt
  if (client.product_mode === "catalog" && client.catalog_url) {
    clientConfig.system_prompt = clientConfig.system_prompt.replaceAll("[URL]", client.catalog_url);
    logger.debug("Placeholder [URL] sustituido en system prompt", { catalogUrl: client.catalog_url });
  } else if (client.product_mode === "catalog" && !client.catalog_url) {
    logger.warn("Modo catálogo sin catalog_url configurada en la DB", { clientId: client.id });
  }

  // 7. Guardar mensajes del lote en historial
  for (const msgText of batchMessages) {
    await saveUserMessage(lead.id, msgText);
  }

  const combinedMessage = batchMessages.join("\n");

  // 8. Historial de conversación
  const history = await getConversationHistory(lead.id, clientConfig.conversation_history_limit);

  // 9. Contexto de producto (catálogo o inventario)
  const productContext = await buildProductContext(
    client, combinedMessage, history, clientConfig, lead, phone, provider
  );
  if (productContext.paused) {
    return { ok: true, skipped: true, reason: productContext.reason };
  }

  // 10. Clasificar y generar respuesta en paralelo.
  //     Ambas operaciones leen el mismo `history` y son completamente independientes,
  //     por lo que corren concurrentemente sin latencia adicional para el usuario.
  //     El resultado de clasificación se escribe junto con el mensaje via RPC atómica.
  const [classificationResult, { response, orderData }] = await Promise.all([
    maybeClassify(lead.id, history, clientConfig, phone, lead.classification),
    generateResponse(history, clientConfig, productContext.inventorySection || undefined),
  ]);

  // 11. Persistir mensaje + clasificación en una sola RPC atómica y enviar al cliente.
  await persistAndRespond(
    lead, phone, response, orderData, provider,
    classificationResult, productContext.productIntentData
  );

  return { ok: true };
}
