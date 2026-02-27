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

// ---------------------------------------------------------------------------
// Legacy raw payload — kept for reference and used inside adapters/twochat.ts
// ---------------------------------------------------------------------------

export interface RequestPayload {
  sent_by: string;
  remote_phone_number: string;
  channel_phone_number: string;
  message: {
    text?: string;
    media?: {
      url: string;
      type: string;      // raw 2chat type: 'image' | 'ptt' | 'audio' | 'video' | 'document'
      mime_type: string;
    };
    /** Present when the user quotes (replies to) a previous message in WhatsApp. */
    quoted_msg?: {
      id: string;
      session_key: string;
      message: {
        text?: string;
      };
      created_at: string;
      remote_phone_number: string;
      channel_phone_number: string;
      sent_by: string;
      contact?: {
        first_name?: string | null;
        last_name?: string | null;
        friendly_name?: string | null;
        device?: string | null;
      };
    };
  };
  contact: {
    first_name?: string | null;
    last_name?: string | null;
  };
}

export interface Lead {
  id: string;
  phone: string;
  client_id?: string;
  classification?: 'hot' | 'warm' | 'cold' | null;
  score?: number | null;
  bot_paused?: boolean;
  bot_paused_reason?: string;
  resumed_at?: string | null;
}

export interface AgentPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  agent_type: "sales" | "intent" | "classifier";
  client_id: string | null; // null = global (intent)
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface Client {
  id: string;
  name: string;
  business_type?: string;
  channel_phone_number: string; // WhatsApp business number (unique identifier)
  active: boolean;
  sales_prompt_id?: string;     // FK → agent_prompts
  llm_model: string;
  llm_temperature: number;
  conversation_history_limit: number;
  plan_id?: string;
  product_mode: 'inventory' | 'catalog'; // How products are handled for this client
  catalog_url?: string | null;           // DEPRECATED — use consult_catalog_url / show_catalog_url
  consult_catalog_url?: string | null;   // URL the agent queries to search products (WooCommerce, Shopify, etc.)
  show_catalog_url?: string | null;      // URL shown to the lead when they ask for the catalog
  notification_phone?: string | null;    // Sales agent WhatsApp for hot-lead alerts (intl. format, no +)
}

export interface LLMModelResolved {
  model_id: string;          // 'gpt-4o-mini', 'gpt-4o', 'o3'
  provider_slug: string;     // 'openai', 'anthropic'…
  chat_endpoint_url: string; // URL completa del endpoint chat_completions
  api_key_header: string;    // 'Authorization', 'x-api-key'…
  api_key_prefix: string;    // 'Bearer' o '' (vacío para Anthropic)
}

export interface ClientConfig {
  system_prompt: string;
  llm_temperature: number;
  conversation_history_limit: number;
  plan_name: string;
  llm: LLMModelResolved;
}

export interface Message {
  lead_id: string;
  role: "user" | "assistant";
  content: string;
}

export interface ExtractedData {
  need?: string;
  timeline?: string;
  budget?: string;
  authority?: string;
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
  price: string | null;
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

export interface ProductIntent {
  has_product_intent: boolean;
  brand: string | null;
  model: string | null;
  colors: string[];
  sizes: string[];
  customer_type: "detal" | "mayorista" | null;
  needs_images: boolean;
  confidence: "high" | "medium" | "low";
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

export type BotPausedReason = "no_catalog" | "out_of_stock" | "needs_images" | "transferred" | "order_confirmed" | "human_takeover" | "price_exception";

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
