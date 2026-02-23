// WhatsApp service - handles sending messages via 2chat

import { createLogger } from "../utils/logger.ts";

const logger = createLogger("whatsapp");

const TWOCHAT_API_KEY = Deno.env.get("TWOCHAT_API_KEY")!;
const TWOCHAT_FROM = Deno.env.get("TWOCHAT_FROM_NUMBER")!;
const WPP_ORQUESTER_PROVIDER_URL = Deno.env.get("WPP_ORQUESTER_PROVIDER_URL")!;
const WPP_ORQUESTER_PROVIDER_PATH = Deno.env.get("WPP_ORQUESTER_PROVIDER_PATH")!;

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000; // 1s → 2s → 4s (exponential backoff)

/**
 * Send a WhatsApp message via 2chat API.
 * Retries up to MAX_ATTEMPTS times with exponential backoff before throwing.
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(
        `${WPP_ORQUESTER_PROVIDER_URL}${WPP_ORQUESTER_PROVIDER_PATH}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-API-Key": TWOCHAT_API_KEY,
          },
          body: JSON.stringify({
            to_number: to,
            from_number: TWOCHAT_FROM,
            text,
          }),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
      }

      logger.info("Mensaje WhatsApp enviado", { to, status: response.status, attempt });
      return;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (attempt < MAX_ATTEMPTS) {
        const waitMs = RETRY_BASE_MS * 2 ** (attempt - 1);
        logger.warn("Fallo al enviar WhatsApp, reintentando", {
          to,
          attempt,
          nextRetryMs: waitMs,
          error: lastError.message,
        });
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  }

  logger.error("Fallo definitivo enviando WhatsApp tras todos los intentos", {
    to,
    attempts: MAX_ATTEMPTS,
    error: lastError?.message,
  });
  throw lastError!;
}
