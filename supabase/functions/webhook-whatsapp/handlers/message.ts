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

import type { NormalizedMessage, WhatsAppProvider, Lead, Client, ClientConfig, OrderData, ReservationData, HandoffData, BotPausedReason, Message, Classification, ExtractedData, VisionResult } from "../types/index.ts";

import { getOrCreateLead, saveOrderData, pauseLeadWithHandoff } from "../services/lead.ts";
import { notifyHotLead, notifyHandoff } from "../services/notification.ts";
import { classifyConversation } from "../services/classifier.ts";
import {
  saveUserMessage,
  saveBotResponse,
  getConversationHistory,
  getConversationHistoryLength,
} from "../services/conversation.ts";
import { generateResponse } from "../services/llm.ts";
import { getClientConfig, getClientByChannelPhone } from "../services/client.ts";
import { hasProductKeywords, extractProductIntent } from "../services/intent.ts";
import { queryInventory, clientHasCatalog, buildInventorySection, buildCatalogSection, buildCatalogSearchSection } from "../services/inventory.ts";
import { searchCatalog, buildSearchQuery, fetchAllServices, buildServicesContextBlock } from "../services/catalogSearch.ts";
import { enqueueAndDebounce } from "../services/messageQueue.ts";
import { describeProductImage } from "../services/vision.ts";
import { transcribeAudio } from "../services/audio.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("message-handler");

// ---------------------------------------------------------------------------
// Helper: pausar lead + notificar al agente si corresponde
// ---------------------------------------------------------------------------
// Centraliza la lógica de "¿debo notificar?" para todos los puntos de pausa.
// - urgent    → siempre notifica (si hay notificationPhone)
// - requested → notifica solo si notifyOnRequested = true (config del cliente)
// - technical → nunca notifica
// El caller es responsable de enviar el mensaje al lead ANTES de llamar esta función.

async function pauseAndMaybeNotify(
  leadId: string,
  leadPhone: string,
  reason: BotPausedReason,
  notificationPhone: string | null | undefined,
  notifyOnRequested: boolean,
  provider: WhatsAppProvider,
  handoffReason?: string
): Promise<void> {
  const handoffMode = await pauseLeadWithHandoff(leadId, reason, handoffReason);
  const shouldNotify =
    handoffMode === "urgent" ||
    (handoffMode === "requested" && notifyOnRequested);

  if (shouldNotify && notificationPhone) {
    // fire-and-forget — notification failure never blocks the main flow
    notifyHandoff(provider, notificationPhone, leadPhone, leadId, handoffMode, handoffReason);
  }
}

// ---------------------------------------------------------------------------
// Pipeline: resolución de texto
// ---------------------------------------------------------------------------
// Convierte cualquier tipo de mensaje (texto, imagen, audio) en texto plano.
// Retorna null si el tipo de media no está soportado.
// Cuando hay una imagen, retorna también el VisionResult estructurado para que
// buildProductContext decida el camino (directo / catalogSearch / handoff humano).

type ResolvedMessage = { text: string; visionResult?: VisionResult };

/** Converts a VisionResult to a human-readable string for injection into the LLM context. */
function visionResultToText(result: VisionResult): string {
  if (result.type === "no_product") return "imagen sin producto identificable";

  function priceLabel(p: { price_detal: string | null; price_mayorista: string | null }): string | null {
    const parts: string[] = [];
    if (p.price_detal)     parts.push(`precio detal: ${p.price_detal}`);
    if (p.price_mayorista) parts.push(`precio mayorista: ${p.price_mayorista}`);
    return parts.length ? parts.join(" / ") : null;
  }

  if (result.type === "catalog") {
    return result.products
      .map((p) => [p.name, p.reference, p.attributes, priceLabel(p)].filter(Boolean).join(", "))
      .join("; ");
  }
  // product
  return [result.name, result.brand, result.reference, result.attributes, priceLabel(result)]
    .filter(Boolean)
    .join(", ");
}

async function resolveMessageText(
  msg: NormalizedMessage
): Promise<ResolvedMessage | null> {
  const { text: incomingText, media: incomingMedia, phone } = msg;

  if (incomingText && incomingMedia?.type === "image") {
    logger.info("Imagen con texto recibida, procesando con Vision API", { phone, url: incomingMedia.url });
    const visionResult = await describeProductImage(incomingMedia.url);
    const description = visionResultToText(visionResult);
    logger.info("Imagen con texto procesada", { phone, text: incomingText, description });
    return { text: `${incomingText}\n[Imagen adjunta: ${description}]`, visionResult };
  }

  if (incomingText) {
    return { text: incomingText };
  }

  if (incomingMedia?.type === "image") {
    logger.info("Imagen recibida, procesando con Vision API", { phone, url: incomingMedia.url });
    const visionResult = await describeProductImage(incomingMedia.url);
    logger.info("Imagen procesada", { phone, type: visionResult.type });

    if (visionResult.type === "no_product") {
      // Vision couldn't identify a product — give the LLM a clear instruction
      // so it asks for reference/description. VisionResult is still threaded through
      // so buildProductContext can avoid catalog search for this case.
      logger.debug("Vision no identificó producto — usando marker de acción", { phone });
      return {
        text: "[El cliente envió una imagen pero no se pudo identificar el producto. Pídele la referencia del catálogo o que describa qué producto busca.]",
        visionResult,
      };
    }

    const description = visionResultToText(visionResult);
    // Prefix preserves intent context for the classifier
    return {
      text: `[Imagen enviada por el cliente — producto de interés]: ${description}`,
      visionResult,
    };
  }

  if (incomingMedia?.type === "audio") {
    logger.info("Audio recibido, transcribiendo con Whisper", { phone, url: incomingMedia.url, mime: incomingMedia.mimeType });
    const transcription = await transcribeAudio(incomingMedia.url, incomingMedia.mimeType);
    logger.info("Audio transcrito", { phone, transcription });
    return { text: transcription };
  }

  // Video, documento — no soportado aún
  logger.debug("Tipo de media no soportado, ignorando", { phone, type: incomingMedia?.type });
  return null;
}

// ---------------------------------------------------------------------------
// Pipeline: contexto de producto
// ---------------------------------------------------------------------------
// Decide si inyectar contexto de catálogo o inventario al LLM según capabilities.
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
  provider: WhatsAppProvider,
  visionResult?: VisionResult
): Promise<ProductContextResult> {
  const capabilities = clientConfig.capabilities;

  if (capabilities.catalog) {
    const consultUrl = client.consult_catalog_url;
    const showUrl    = client.show_catalog_url;

    if (!consultUrl && !showUrl) {
      logger.info("Sin URL de catálogo configurada, bot pausado", { leadId: lead.id });
      await pauseAndMaybeNotify(lead.id, phone, "no_catalog", client.notification_phone, client.notify_on_handoff_requested ?? false, provider);
      return { paused: true, reason: "bot_paused:no_catalog" };
    }

    // --- Path decision when an image was sent ---
    if (visionResult?.type === "product") {
      const { confidence } = visionResult;

      // low confidence → handoff to human
      if (confidence === "low") {
        logger.info("Vision con baja confianza — transfiriendo a humano", { leadId: lead.id });
        await provider.sendMessage(phone, "No pude identificar bien el producto en la imagen. Un asesor te ayuda enseguida. 📸");
        await pauseAndMaybeNotify(lead.id, phone, "vision_low_conf", client.notification_phone, client.notify_on_handoff_requested ?? false, provider);
        return { paused: true, reason: "bot_paused:vision_low_conf" };
      }

      // medium confidence + consultUrl → search external catalog
      if (confidence === "medium" && consultUrl) {
        const query: string = buildSearchQuery(visionResult);
        if (query) {
          logger.debug("Buscando producto en catálogo externo", { query, consultUrl });
          const found = await searchCatalog(consultUrl, query);
          if (found.length > 0) {
            logger.info("Producto encontrado en catálogo externo", { query, results: found.length });
            return { paused: false, inventorySection: buildCatalogSearchSection(found, showUrl) };
          }
          // No match found → handoff to human
          logger.info("Sin coincidencias en catálogo externo — transfiriendo a humano", { leadId: lead.id, query });
          await provider.sendMessage(phone, "Déjame buscar ese producto con un asesor. Te contactamos en breve. 🔍");
          await pauseAndMaybeNotify(lead.id, phone, "no_catalog_match", client.notification_phone, client.notify_on_handoff_requested ?? false, provider);
          return { paused: true, reason: "bot_paused:no_catalog_match" };
        }
      }
      // high confidence or medium without consultUrl → fall through to catalog section
      // (vision description is already embedded in combinedMessage)
    }

    // PATH 0: prompt-driven full-catalog injection via {{SERVICIOS_INYECTADOS}} placeholder.
    // For service catalogs (masajes, clases, etc.) where ALL services must be in context on
    // every turn — not just when keywords are detected.
    // Runs after vision decisions so low/medium-confidence image handoffs still apply.
    if (consultUrl && clientConfig.system_prompt.includes("{{SERVICIOS_INYECTADOS}}")) {
      logger.debug("Placeholder {{SERVICIOS_INYECTADOS}} detectado — cargando todos los servicios", { consultUrl });
      const rows = await fetchAllServices(consultUrl);
      if (rows.length > 0) {
        logger.info("Servicios cargados para inyección en placeholder", { count: rows.length });
        return { paused: false, inventorySection: buildServicesContextBlock(rows, clientConfig.catalogConfig) };
      }
      logger.warn("fetchAllServices retornó vacío — cayendo a path normal", { consultUrl });
    }

    // PATH 2: text message with product keywords → search external catalog
    // Applies to service businesses (masajes, clases, etc.) where text queries need a real lookup.
    if (consultUrl && hasProductKeywords(combinedMessage, clientConfig.keywords)) {
      const searchQuery = combinedMessage.slice(0, 150);
      logger.debug("Keywords detectadas en catalog mode — buscando en catálogo externo", { searchQuery, consultUrl });
      const found = await searchCatalog(consultUrl, searchQuery);
      if (found.length > 0) {
        logger.info("Producto/servicio encontrado en catálogo externo (texto)", { results: found.length });
        return { paused: false, inventorySection: buildCatalogSearchSection(found, showUrl) };
      }
      // No match → fall through to show catalog URL
      logger.debug("Sin coincidencias en catálogo externo para texto — mostrando URL");
    }

    // Default: show catalog URL (no keywords, high confidence images, catalog screenshots, no results)
    const catalogUrl = showUrl ?? consultUrl!;
    logger.debug("Contexto de catálogo construido", { catalogUrl });
    return { paused: false, inventorySection: buildCatalogSection(catalogUrl) };
  }

  if (!capabilities.inventory) {
    return { paused: false, inventorySection: "" };
  }

  if (!hasProductKeywords(combinedMessage, clientConfig.keywords)) {
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
      brands: intent.brands,
      model: intent.model,
      reference: intent.reference,
      category: intent.category,
      customer_type: intent.customer_type,
      confidence: intent.confidence,
    },
  };

  const hasCatalog = await clientHasCatalog(client.id);
  if (!hasCatalog) {
    logger.info("Sin productos en inventario, bot pausado", { leadId: lead.id });
    await pauseAndMaybeNotify(lead.id, phone, "no_catalog", client.notification_phone, client.notify_on_handoff_requested ?? false, provider);
    return { paused: true, reason: "bot_paused:no_catalog" };
  }

  if (intent.needs_images) {
    logger.info("Cliente solicita imágenes, bot pausado", { leadId: lead.id });
    await provider.sendMessage(phone, "Enseguida te paso las fotos. Un asesor te atenderá en un momento. 📸");
    await pauseAndMaybeNotify(lead.id, phone, "needs_images", client.notification_phone, client.notify_on_handoff_requested ?? false, provider);
    return { paused: true, reason: "bot_paused:needs_images" };
  }

  const products = await queryInventory(client.id, intent);
  if (products.length === 0) {
    logger.info("Sin stock para la consulta, bot pausado", { leadId: lead.id, intent });
    await provider.sendMessage(phone, "Déjame verificar disponibilidad. Un asesor te confirma en breve. 🔍");
    await pauseAndMaybeNotify(lead.id, phone, "out_of_stock", client.notification_phone, client.notify_on_handoff_requested ?? false, provider);
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
  reservationData: ReservationData | null,
  handoffData: HandoffData | null,
  provider: WhatsAppProvider,
  classification: Classification | null,
  productIntentData: Record<string, unknown> | undefined,
  notificationPhone: string | null | undefined,
  notifyOnRequested: boolean
): Promise<void> {
  // Si el agente confirmó una compra o reserva, el lead es implícitamente hot.
  // Esto corrige el caso donde maybeClassify fue omitida por la gate de frecuencia
  // justo en el turno donde el cliente expresó intención de compra/agendamiento.
  const hasConversion = orderData !== null || reservationData !== null;
  const effectiveClassification: Classification | null =
    hasConversion && classification?.classification !== "hot"
      ? {
          score: 100,
          classification: "hot",
          extracted: classification?.extracted ?? {} as ExtractedData,
          reasoning: orderData
            ? "Pedido confirmado por el agente — lead promovido a hot automáticamente"
            : "Reserva confirmada por el agente — lead promovido a hot automáticamente",
        }
      : classification;

  // Construir payload de clasificación para la RPC (si aplica).
  // productIntentData ya tiene la forma { product_intent: {...} } — no re-envolver.
  const classificationPayload = effectiveClassification ? {
    score: effectiveClassification.score,
    classification: effectiveClassification.classification,
    extracted_data: {
      ...effectiveClassification.extracted,
      ...(productIntentData ?? {}),
    },
    reasoning: effectiveClassification.reasoning,
  } : undefined;

  // Transacción atómica: insertar mensaje + actualizar clasificación del lead en una sola RPC.
  await saveBotResponse(lead.id, response, classificationPayload);

  // Enviar al cliente (llamada externa — fuera de la transacción)
  await provider.sendMessage(phone, response);

  // Notificar al agente de ventas si:
  // - El lead acaba de volverse hot (clasificación previa != hot), O
  // - El lead ya era hot pero en este turno confirmó una compra/reserva (hasConversion).
  // fire-and-forget: el fallo de notificación nunca afecta al prospecto.
  if (
    effectiveClassification?.classification === "hot" &&
    (lead.classification !== "hot" || hasConversion) &&
    notificationPhone
  ) {
    notifyHotLead(provider, notificationPhone, phone, lead.id, hasConversion);
  }

  if (orderData) {
    await saveOrderData(lead.id, orderData);
    // pauseLeadWithHandoff sets handoff_mode='urgent' in DB.
    // notifyHotLead (above) already handles the sales agent alert for confirmed orders.
    await pauseLeadWithHandoff(lead.id, "order_confirmed");
    logger.info("Pedido confirmado — bot pausado, humano en control", {
      phone,
      leadId: lead.id,
      orderData,
    });
  }

  if (reservationData) {
    // Reuse order_data JSONB field to persist reservation details
    await saveOrderData(lead.id, reservationData as unknown as OrderData);
    // pauseLeadWithHandoff sets handoff_mode='urgent' in DB.
    // notifyHotLead (above) already handles the sales agent alert for confirmed reservations.
    await pauseLeadWithHandoff(lead.id, "reservation_confirmed");
    logger.info("Reserva confirmada — bot pausado, equipo toma control", {
      phone,
      leadId: lead.id,
      reservationData,
    });
  }

  if (handoffData) {
    // Generic LLM-initiated handoff via HANDOFF_INICIO...HANDOFF_FIN block.
    // Replaces the old hardcoded domicilio_exception and any future client-specific escalations.
    const reason: BotPausedReason = handoffData.urgente ? "llm_handoff_urgent" : "llm_handoff";
    logger.info("LLM solicitó handoff — bot pausado", { phone, leadId: lead.id, reason, motivo: handoffData.motivo });
    await pauseAndMaybeNotify(lead.id, phone, reason, notificationPhone, notifyOnRequested, provider, handoffData.motivo);
  }
}

// ---------------------------------------------------------------------------
// Pipeline: clasificación del lead (agente independiente)
// ---------------------------------------------------------------------------
// Se ejecuta DESPUÉS de enviar la respuesta al cliente.
// Nunca lanza excepción — un fallo de clasificación no afecta al usuario.
// Usa un LLM separado con temperatura=0 sin rol conversacional.

const CLASSIFY_MIN_MESSAGES = 3;  // mínimo de mensajes del usuario antes de la primera clasificación
const CLASSIFY_EVERY_N = 2;        // clasificar cada N mensajes del usuario

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
  historyLength: number,
  phone: string,
  currentClassification: Lead["classification"]
): Promise<Classification | null> {
  // Lead ya es hot: la clasificación alcanzó su objetivo, no tiene sentido re-evaluar.
  if (currentClassification === "hot") {
    logger.debug("Clasificación omitida: lead ya es hot", { leadId, phone });
    return null;
  }

  // Historial insuficiente: con menos de N mensajes del usuario no hay contexto real.
  const userMessageCount = historyLength;
  if (userMessageCount < CLASSIFY_MIN_MESSAGES) {
    logger.debug("Clasificación omitida: contexto insuficiente", { leadId, phone, userMessageCount });
    return null;
  }

  // Frecuencia: clasificar en el mensaje CLASSIFY_MIN_MESSAGES y luego cada CLASSIFY_EVERY_N mensajes.
  // Esto asegura que la primera clasificación ocurra en el mensaje 3, 5, 7… (no 4, 6, 8…)
  if ((userMessageCount - CLASSIFY_MIN_MESSAGES) % CLASSIFY_EVERY_N !== 0) {
    logger.debug("Clasificación pospuesta", { leadId, phone, userMessageCount, next: CLASSIFY_EVERY_N - ((userMessageCount - CLASSIFY_MIN_MESSAGES) % CLASSIFY_EVERY_N) });
    return null;
  }

  try {
    const result = await classifyConversation(history);
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
  const resolved = await resolveMessageText(msg);
  if (resolved === null) {
    return { ok: true, skipped: true, reason: `unsupported media type: ${incomingMedia?.type}` };
  }

  // 4b. Enriquecer mensaje con contexto de cita (quoted message)
  if (msg.quotedText) {
    resolved.text = `${resolved.text}\n[El cliente responde al mensaje: "${msg.quotedText}"]`;
  }

  // 5. Debounce: agrupar mensajes rápidos del mismo lead (ventana configurable por cliente)
  const batchMessages = await enqueueAndDebounce(phone, channelPhone, resolved.text, client.debounce_ms);
  if (batchMessages === null) {
    logger.debug("Mensaje agrupado en lote de otro mensaje más reciente", { phone });
    return { ok: true, skipped: true, reason: "debounced" };
  }
  logger.info("Procesando lote de mensajes", { phone, count: batchMessages.length });

  // 6. Configuración del cliente (cacheada en memoria)
  const clientConfig = await getClientConfig(client.id);

  // 6b. Sustituir placeholder [URL] del catálogo en el system prompt
  if (clientConfig.capabilities.catalog) {
    const showUrl = client.show_catalog_url;
    if (showUrl) {
      clientConfig.system_prompt = clientConfig.system_prompt.replaceAll("[URL]", showUrl);
      logger.debug("Placeholder [URL] sustituido en system prompt", { showUrl });
    } else {
      logger.warn("Modo catálogo sin show_catalog_url configurada", { clientId: client.id });
    }
  }

  // 7. Guardar mensajes del lote en historial
  for (const msgText of batchMessages) {
    await saveUserMessage(lead.id, msgText);
  }

  const combinedMessage = batchMessages.join("\n");

  // 8. Historial de conversación (ambas queries son independientes → paralelas)
  const [history, historyLength] = await Promise.all([
    getConversationHistory(lead.id, clientConfig.conversation_history_limit),
    getConversationHistoryLength(lead.id),
  ]);

  // 9. Contexto de producto (catálogo o inventario)
  const productContext = await buildProductContext(
    client, combinedMessage, history, clientConfig, lead, phone, provider, resolved.visionResult
  );
  if (productContext.paused) {
    return { ok: true, skipped: true, reason: productContext.reason };
  }

  // 10. Clasificar y generar respuesta en paralelo.
  //     Ambas operaciones leen el mismo `history` y son completamente independientes,
  //     por lo que corren concurrentemente sin latencia adicional para el usuario.
  //     El resultado de clasificación se escribe junto con el mensaje via RPC atómica.
  const [classificationResult, { response, orderData, reservationData, handoffData }] = await Promise.all([
    maybeClassify(lead.id, history, historyLength, phone, lead.classification),
    generateResponse(history, clientConfig, productContext.inventorySection || undefined),
  ]);

  // 11. Persistir mensaje + clasificación en una sola RPC atómica y enviar al cliente.
  await persistAndRespond(
    lead, phone, response, orderData, reservationData, handoffData, provider,
    classificationResult, productContext.productIntentData,
    client.notification_phone,
    client.notify_on_handoff_requested ?? false
  );

  return { ok: true };
}
