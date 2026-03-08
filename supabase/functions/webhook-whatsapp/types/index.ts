// Types and interfaces for the webhook handler

// ---------------------------------------------------------------------------
// Provider abstraction — adapter + sender interface
// ---------------------------------------------------------------------------

/** Normalized media types shared across all WhatsApp providers */
export type NormalizedMediaType = "image" | "audio" | "video" | "document";

/**
 * Provider-agnostic incoming message.
 * Adapters (2chat, WA Business API, etc.) convert raw payloads to this shape
 * before passing them to the message handler — keeping business logic decoupled
 * from provider-specific payload formats.
 */
export interface NormalizedMessage {
  phone: string;        // customer's phone number
  channelPhone: string; // business WhatsApp number (used to look up the client)
  sentBy: "user" | "bot";
  text?: string;
  media?: {
    url: string;             // always a directly downloadable URL
    type: NormalizedMediaType;
    mimeType: string;        // e.g. "audio/ogg; codecs=opus"
  };
  /** Plain text of the message being replied to, if the user quoted a previous message. */
  quotedText?: string;
}

/**
 * Interface every WhatsApp provider must implement.
 * Swap the implementation in index.ts to change provider without touching
 * the message handler.
 */
export interface WhatsAppProvider {
  sendMessage(to: string, text: string): Promise<void>;
}

export interface Lead {
  id: string;
  phone: string;
  client_id?: string;
  classification?: 'hot' | 'warm' | 'cold' | null;
  score?: number | null;
  bot_paused?: boolean;
  bot_paused_reason?: string;
  bot_paused_at?: string | null;
  resumed_at?: string | null;
  status?: 'bot_active' | 'human_active' | 'resolved' | 'lost' | null;
  handoff_mode?: HandoffMode | null;
  handoff_reason?: string | null;
  order_data?: Record<string, unknown> | null;
  order_confirmed_at?: string | null;
  reasoning?: string | null;
}

export interface AgentPrompt {
  id: string;
  name: string;
  content: string;
  agent_type: "sales" | "intent" | "classifier" | "vision";
  client_id: string | null; // null = global (intent)
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

/**
 * Feature flags that control agent behaviour per client.
 * Replaces the binary product_mode for multi-niche support.
 * Stored as JSONB in clients.capabilities (migration 040).
 */
export interface ClientCapabilities {
  catalog: boolean;   // has external catalog URL (WooCommerce / Shopify)
  inventory: boolean; // has internal product inventory in DB
  faqs: boolean;      // has FAQ entries in client_faqs table
}

/** A single FAQ entry loaded from client_faqs and injected into the system prompt. */
export interface ClientFAQ {
  question: string;
  answer: string;
}

export interface Client {
  id: string;
  name: string;
  business_type?: string;
  channel_phone_number: string; // WhatsApp business number (unique identifier)
  active: boolean;
  sales_prompt_id?: string;     // FK → agent_prompts
  conversation_history_limit: number;
  plan_id?: string;
  capabilities: ClientCapabilities; // migration 040 — feature flags per client
  consult_catalog_url?: string | null;   // URL the agent queries to search products (WooCommerce, Shopify, etc.)
  show_catalog_url?: string | null;      // URL shown to the lead when they ask for the catalog
  notification_phone?: string | null;    // Sales agent WhatsApp for hot-lead alerts (intl. format, no +)
  notify_on_handoff_requested?: boolean | null; // Alert agent on non-urgent handoffs (needs_images, vision_low_conf, etc.)
  debounce_ms?: number | null;           // Debounce window in ms (null = use global DEBOUNCE_MS env var)
  // migration 045 — per-client intent context
  keywords?: string[];           // keyword override for hasProductKeywords pre-filter
  brands?: string[];             // brand list injected into {{brands}} of the intent prompt
  categories?: string[];         // category list injected into {{categories}} of the intent prompt
  business_description?: string | null; // injected into {{business_description}} of the intent prompt
}

export interface LLMModelResolved {
  model_id: string;          // 'gpt-4o-mini', 'gpt-4o', 'o3'
  provider_slug: string;     // 'openai', 'anthropic'…
  chat_endpoint_url: string; // URL completa del endpoint chat_completions
  api_key_header: string;    // 'Authorization', 'x-api-key'…
  api_key_prefix: string;    // 'Bearer' o '' (vacío para Anthropic)
}

// ---------------------------------------------------------------------------
// Catalog Config — per-client external catalog column mapping (migration 046)
// ---------------------------------------------------------------------------

/**
 * Maps logical display fields to actual column names in the client's Google Sheet.
 * Keys that are absent fall back to the multi-alias defaults in buildServicesContextBlock.
 */
export interface CatalogColMapping {
  name?: string;            // column holding the service/product name
  price?: string;           // unified price column (no sede/domicilio split)
  price_sede?: string;      // price at physical location
  price_domicilio?: string; // price for home-service delivery
  available?: string;       // availability column
  description?: string;     // description column
  notes?: string;           // extra notes column
  [key: string]: string | undefined; // allow arbitrary extra mappings
}

/** A single extra field to read from the sheet and display with a custom label. */
export interface CatalogExtraField {
  column: string; // lowercase header name in the sheet
  label: string;  // display label injected into the context block (e.g. "Duración")
}

/** Per-client configuration for external catalog (Google Sheets) reading. */
export interface ClientCatalogConfig {
  col_mapping: CatalogColMapping;
  extra_fields: CatalogExtraField[];
  static_context: string | null;
}

export interface ClientConfig {
  system_prompt: string;
  llm_temperature: number;
  conversation_history_limit: number;
  plan_name: string;
  llm: LLMModelResolved;
  faqs: ClientFAQ[];               // Active FAQs to inject into system prompt
  capabilities: ClientCapabilities; // Resolved feature flags (never null at runtime)
  // migration 045 — per-client intent context (always arrays at runtime, never null)
  keywords: string[];              // override for hasProductKeywords pre-filter
  brands: string[];                // injected into {{brands}} of the intent prompt
  categories: string[];            // injected into {{categories}} of the intent prompt
  business_description: string | null; // injected into {{business_description}} of the intent prompt
  // migration 046 — per-client catalog column mapping (null when not configured)
  catalogConfig: ClientCatalogConfig | null;
}

export interface Message {
  lead_id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ExtractedData {
  need?: string | null;
  customer_type?: "detal" | "mayorista" | null;
  budget?: string | null;
  timeline?: string | null;
  productos_mencionados?: string[];
  objecciones_detectadas?: string[];
  venta_cruzada_oportunidad?: boolean;
}

export interface Classification {
  score: number;
  classification: "hot" | "warm" | "cold";
  extracted: ExtractedData;
  reasoning: string;
}

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// ---------------------------------------------------------------------------
// Vision Agent — structured output
// ---------------------------------------------------------------------------

export interface VisionProductData {
  name: string;
  brand: string | null;
  reference: string | null;
  attributes: string | null; // color, talla, fragancia, material, volumen, etc.
  price_detal: string | null;     // precio detal si visible en la imagen
  price_mayorista: string | null; // precio mayorista/por mayor si visible en la imagen
}

export type VisionResult =
  | ({ type: "product"; confidence: "high" | "medium" | "low" } & VisionProductData)
  | { type: "catalog"; products: VisionProductData[] }
  | { type: "no_product" };

// ---------------------------------------------------------------------------
// Catalog Search — external e-commerce product
// ---------------------------------------------------------------------------

export interface CatalogProduct {
  name: string;
  price: string | null;
  url: string | null;
  available: boolean;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Inventory & Intent Agent
// ---------------------------------------------------------------------------

export type IntentType =
  | "product_specific"
  | "catalog_browse"
  | "category_browse"
  | "image_request"
  | "info_request"
  | "none";

export type SuggestedResponseType =
  | "send_catalog"
  | "ask_details"
  | "show_product"
  | "answer_info"
  | "greet";

/** Structured intent extracted by the intent agent (aligned with prompt_v3 schema). */
export interface ProductIntent {
  intent_type: IntentType;
  has_product_intent: boolean;
  /** Normalized brand names. Empty array when no brand detected. */
  brands: string[];
  model: string | null;
  /** Specific product reference or name when no brand/model hierarchy exists. */
  reference: string | null;
  /** Product or service category, normalized to client categories when possible. */
  category: string | null;
  colors: string[];
  sizes: string[];
  customer_type: "detal" | "mayorista" | null;
  needs_images: boolean;
  confidence: "high" | "medium" | "low";
  suggested_response_type: SuggestedResponseType;
}

export interface ClientProduct {
  id: string;
  client_id: string;
  name: string;
  brand: string | null;
  model: string | null;
  category: string | null;
  available_sizes: string[];
  price_retail: number | null;
  price_wholesale: number | null;
  description: string | null;
  image_urls: string[];
  stock_status: "available" | "low_stock" | "out_of_stock";
  is_active: boolean;
}

export type HandoffMode = "technical" | "observer" | "requested" | "urgent";

/** Structured data emitted by the LLM in a HANDOFF_INICIO...HANDOFF_FIN block. */
export interface HandoffData {
  motivo: string;
  urgente: boolean;
}

export type BotPausedReason =
  // Grupo TECHNICAL — pausa automática del sistema, sin urgencia de notificación
  | "no_catalog"
  | "out_of_stock"
  | "config_error"
  // Grupo REQUESTED — handoff no crítico, humano debe atender
  | "needs_images"
  | "vision_low_conf"    // formerly human_takeover (vision low-confidence path)
  | "no_catalog_match"   // formerly human_takeover (catalog search no-results path)
  | "llm_handoff"        // LLM emitió HANDOFF_INICIO con urgente: false
  // Grupo URGENT — acción humana inmediata requerida
  | "order_confirmed"
  | "reservation_confirmed"
  | "llm_handoff_urgent" // LLM emitió HANDOFF_INICIO con urgente: true
  // Deprecated — backward compat con rows existentes en BD
  | "human_takeover"        // @deprecated → usar vision_low_conf o no_catalog_match
  | "domicilio_exception";  // @deprecated → usar llm_handoff

export interface OrderItem {
  producto: string | null;
  talla: string | null;
  cantidad: number | null;
}

export interface OrderData {
  pedido_confirmado: true;
  ciudad_envio: string | null;
  tipo_cliente: "detal" | "mayorista" | null;
  items: OrderItem[];
}

/** Structured data emitted by the LLM when a service booking is confirmed (RESERVA_INICIO...RESERVA_FIN). */
export interface ReservationData {
  reserva_confirmada: true;
  nombre_lead: string | null;
  servicio: string | null;
  modalidad: "sede" | "domicilio" | null;
  direccion_domicilio: string | null;
  personas: number | null;
  fecha: string | null;
  hora: string | null;
  add_ons: string[];
  precio_servicio: number | null;
  recargo_domicilio: number | null;
  precio_total: number | null;
}
