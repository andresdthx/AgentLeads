// Client service - handles client configuration retrieval

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Client, ClientConfig, LLMModelResolved } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("client");

// Cache de configuración de clientes — persiste mientras la Edge Function esté caliente.
// Evita N+1 queries (5 tablas con JOINs) por cada mensaje entrante.
const CONFIG_CACHE = new Map<string, { config: ClientConfig; expiresAt: number }>();
const CONFIG_TTL_MS = 5 * 60 * 1000; // 5 minutos

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Select string that resolves plan → llm_model → provider + chat endpoint
// También hace join al prompt de ventas activo via sales_prompt_id
const CLIENT_WITH_PLAN_SELECT = `
  *,
  agent_prompts!clients_sales_prompt_id_fkey ( content ),
  plans (
    name,
    llm_models (
      model_id,
      llm_providers (
        slug,
        api_key_header,
        api_key_prefix,
        llm_endpoints ( endpoint_type, url )
      )
    )
  )
`;

/**
 * Build LLMModelResolved from a client row that includes the plans join
 */
// deno-lint-ignore no-explicit-any
function resolveLLM(client: any): LLMModelResolved {
  const plan = client.plans;
  const model = plan?.llm_models;
  const provider = model?.llm_providers;
  const endpoints: { endpoint_type: string; url: string }[] =
    provider?.llm_endpoints ?? [];

  const chatEndpoint = endpoints.find((e) => e.endpoint_type === "chat_completions");

  if (!chatEndpoint) {
    // Fallback a OpenAI si no hay plan configurado aún
    return {
      model_id: client.llm_model ?? "gpt-4o-mini",
      provider_slug: "openai",
      chat_endpoint_url: "https://api.openai.com/v1/chat/completions",
      api_key_header: "Authorization",
      api_key_prefix: "Bearer",
    };
  }

  return {
    model_id: model.model_id,
    provider_slug: provider.slug,
    chat_endpoint_url: chatEndpoint.url,
    api_key_header: provider.api_key_header,
    api_key_prefix: provider.api_key_prefix,
  };
}

/**
 * Get client by ID
 */
export async function getClientById(clientId: string): Promise<Client | null> {
  const { data: client } = await supabase
    .from("clients")
    .select()
    .eq("id", clientId)
    .eq("active", true)
    .single();

  return client;
}

/**
 * Get client by channel phone number (WhatsApp Business number)
 */
export async function getClientByChannelPhone(
  channelPhone: string
): Promise<Client | null> {
  const { data: client } = await supabase
    .from("clients")
    .select()
    .eq("channel_phone_number", channelPhone)
    .eq("active", true)
    .single();

  return client;
}

/**
 * Get default client (fallback - should not be used in production)
 */
export async function getDefaultClient(): Promise<Client | null> {
  const { data: client } = await supabase
    .from("clients")
    .select()
    .eq("active", true)
    .limit(1)
    .single();

  return client;
}

/**
 * Get client configuration for LLM — resolves plan → model → provider dynamically.
 * Results are cached for CONFIG_TTL_MS to avoid repeated N+1 queries per message.
 */
export async function getClientConfig(clientId?: string): Promise<ClientConfig> {
  const cacheKey = clientId ?? "__default__";
  const cached = CONFIG_CACHE.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    logger.debug("ClientConfig desde caché", { cacheKey });
    return cached.config;
  }

  // deno-lint-ignore no-explicit-any
  let client: any = null;

  if (clientId) {
    const { data } = await supabase
      .from("clients")
      .select(CLIENT_WITH_PLAN_SELECT)
      .eq("id", clientId)
      .eq("active", true)
      .single();
    client = data;
  }

  if (!client) {
    if (clientId) {
      // El caller pidió un cliente específico — si no existe, es un error real,
      // no un caso donde el fallback sea aceptable.
      throw new Error(`Client "${clientId}" not found or inactive`);
    }

    // Sin clientId (ej: entorno de desarrollo con un solo cliente) — tomar el primero activo.
    const { data } = await supabase
      .from("clients")
      .select(CLIENT_WITH_PLAN_SELECT)
      .eq("active", true)
      .limit(1)
      .single();
    client = data;
  }

  if (!client) {
    throw new Error("No active client found in database");
  }

  const salesPromptContent: string = client.agent_prompts?.content ?? "";

  if (!salesPromptContent) {
    throw new Error(`Client "${client.name}" has no active sales prompt in agent_prompts`);
  }

  const config: ClientConfig = {
    system_prompt: salesPromptContent,
    llm_temperature: client.llm_temperature,
    conversation_history_limit: client.conversation_history_limit,
    plan_name: client.plans?.name ?? "basico",
    llm: resolveLLM(client),
  };

  CONFIG_CACHE.set(cacheKey, { config, expiresAt: Date.now() + CONFIG_TTL_MS });
  logger.debug("ClientConfig cargado desde DB y cacheado", { cacheKey });

  return config;
}
