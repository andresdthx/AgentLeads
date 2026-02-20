// Types and interfaces for the webhook handler

export interface RequestPayload {
  sent_by: string;
  remote_phone_number: string;
  channel_phone_number: string; // WhatsApp business number (identifies the client)
  message: {
    text: string;
  };
  contact: {
    first_name?: string;
  };
}

export interface Lead {
  id: string;
  phone: string;
  client_id?: string;
  bot_paused?: boolean;
  bot_paused_reason?: string;
}

export interface AgentPrompt {
  id: string;
  name: string;
  description?: string;
  content: string;
  agent_type: "sales" | "intent";
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

export type BotPausedReason = "no_catalog" | "out_of_stock" | "needs_images" | "transferred";
