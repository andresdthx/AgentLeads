// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="jsr:@supabase/functions-js/edge-runtime.d.ts" />

import type { RequestPayload } from "./types/index.ts";
import { handleIncomingMessage } from "./handlers/message.ts";

/**
 * Main entry point for WhatsApp webhook
 * Receives requests and delegates to message handler
 */
Deno.serve(async (req) => {
  // Only accept POST requests
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const body: RequestPayload = await req.json();

    // Delegate to message handler
    const result = await handleIncomingMessage(body);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error general:", error);
    return new Response(
      JSON.stringify({
        ok: false,
        error: error.message
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
