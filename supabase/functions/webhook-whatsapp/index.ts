// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

// Adapters: parse raw provider payloads → NormalizedMessage
import { parseTwochatPayload } from "./adapters/twochat.ts";

// Providers: send messages via specific WhatsApp API
import { createTwochatProvider } from "./providers/twochat.ts";

import { handleIncomingMessage } from "./handlers/message.ts";
import { createLogger } from "./utils/logger.ts";

const logger = createLogger("index");

// ---------------------------------------------------------------------------
// Provider selection — set WHATSAPP_PROVIDER env var to switch without code change
//
// Supported values:
//   "2chat"  (default) — 2chat REST API
//   "waba"             — WhatsApp Business API (Meta)
//                        → implement adapters/waba.ts + providers/waba.ts
// ---------------------------------------------------------------------------
const WHATSAPP_PROVIDER = Deno.env.get("WHATSAPP_PROVIDER") ?? "2chat";

// Instantiate provider once per warm Edge Function instance (not per request)
const provider = (() => {
  switch (WHATSAPP_PROVIDER) {
    case "2chat":
    default:
      if (WHATSAPP_PROVIDER !== "2chat") {
        logger.warn(`Proveedor desconocido "${WHATSAPP_PROVIDER}", usando 2chat como fallback`);
      }
      return createTwochatProvider();
  }
})();

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body = await req.json();

    // Normalize raw payload to provider-agnostic NormalizedMessage
    const msg = WHATSAPP_PROVIDER === "2chat"
      ? parseTwochatPayload(body)
      : parseTwochatPayload(body); // swap for wabaAdapter when implementing waba

    if (!msg) {
      // Silently acknowledge: bot echoes, status callbacks, missing fields
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "not_processable" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = await handleIncomingMessage(msg, provider);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    logger.error("Error general no manejado", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response(
      JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
