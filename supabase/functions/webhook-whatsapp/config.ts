// config.ts — Variables de entorno centralizadas con validación al startup.
//
// Este módulo se importa en index.ts (entry point). Si alguna variable requerida
// falta, la Edge Function falla al arrancar con un mensaje claro, no a mitad
// de una conversación con un cliente.

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`[config] Variable de entorno requerida no encontrada: ${name}`);
  }
  return value;
}

export const config = {
  // Supabase
  SUPABASE_URL: requireEnv("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: requireEnv("SUPABASE_SERVICE_ROLE_KEY"),

  // WhatsApp provider
  WHATSAPP_PROVIDER: Deno.env.get("WHATSAPP_PROVIDER") ?? "2chat",
  TWOCHAT_API_KEY: Deno.env.get("TWOCHAT_API_KEY") ?? "",
  TWOCHAT_API_URL: Deno.env.get("TWOCHAT_API_URL") ?? "https://api.2chat.io",

  // LLM
  // LLM_API_KEY_<PROVIDER> tiene precedencia sobre LLM_API_KEY (genérico)
  LLM_API_KEY: Deno.env.get("LLM_API_KEY") ?? "",
} as const;
