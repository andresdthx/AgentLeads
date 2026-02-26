// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

// Valida variables de entorno al arrancar — falla rápido antes de procesar mensajes
import "./config.ts";

// Adapters: parse raw provider payloads → NormalizedMessage
import { parseTwochatPayload } from "./adapters/twochat.ts";

// Providers: send messages via specific WhatsApp API
import { createTwochatProvider } from "./providers/twochat.ts";

import { handleIncomingMessage } from "./handlers/message.ts";
import { createLogger } from "./utils/logger.ts";
import {
  checkRateLimit,
  checkGlobalRateLimit,
  isPayloadTooLarge,
} from "./utils/security.ts";

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

// ---------------------------------------------------------------------------
// Webhook entry point
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // --- Guard: payload demasiado grande (DoS por body) ---
  if (isPayloadTooLarge(req)) {
    logger.warn("Payload rechazado por tamaño excesivo", {
      contentLength: req.headers.get("content-length"),
    });
    return new Response(
      JSON.stringify({ ok: false, error: "Payload too large" }),
      { status: 413, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Guard: rate limit global por canal (IP del origen) ---
  // Usamos el header de IP real si está disponible (Supabase lo inyecta como x-forwarded-for)
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  if (!checkGlobalRateLimit(clientIp)) {
    logger.warn("Rate limit global superado", { clientIp });
    return new Response(
      JSON.stringify({ ok: false, error: "Too many requests" }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": "60",
        },
      }
    );
  }

  try {
    const body = await req.json();

    // Normalize raw payload to provider-agnostic NormalizedMessage
    // Add new cases here when implementing additional providers (e.g. waba)
    let msg;
    if (WHATSAPP_PROVIDER === "2chat") {
      msg = parseTwochatPayload(body);
    } else {
      logger.error("Proveedor de WhatsApp no soportado", { provider: WHATSAPP_PROVIDER });
      return new Response(
        JSON.stringify({ ok: false, error: `Unsupported provider: ${WHATSAPP_PROVIDER}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!msg) {
      // Silently acknowledge: bot echoes, status callbacks, missing fields
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "not_processable" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // --- Guard: rate limit por número de teléfono (anti-flood por usuario) ---
    if (!checkRateLimit(`phone:${msg.phone}`)) {
      logger.warn("Rate limit por teléfono superado", { phone: msg.phone });
      return new Response(
        JSON.stringify({ ok: false, error: "Too many requests" }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": "60",
          },
        }
      );
    }

    // Provider instantiated per-request so from_number matches the inbound channel phone.
    // This supports multiple clients with different WhatsApp numbers on the same account.
    let provider;
    if (WHATSAPP_PROVIDER === "2chat") {
      provider = createTwochatProvider(msg.channelPhone);
    } else {
      logger.error("Proveedor de WhatsApp no soportado para envío", { provider: WHATSAPP_PROVIDER });
      return new Response(
        JSON.stringify({ ok: false, error: `Unsupported provider: ${WHATSAPP_PROVIDER}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
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
