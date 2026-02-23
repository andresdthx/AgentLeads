// Provider: 2chat outbound — implements WhatsAppProvider
//
// Sends messages via the 2chat REST API with exponential backoff retry.
// To switch to WA Business API: create providers/waba.ts implementing the
// same WhatsAppProvider interface and swap it in index.ts.

import type { WhatsAppProvider } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("provider:twochat");

const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 1000; // 1s → 2s → 4s

export function createTwochatProvider(): WhatsAppProvider {
  const apiKey = Deno.env.get("TWOCHAT_API_KEY")!;
  const fromNumber = Deno.env.get("TWOCHAT_FROM_NUMBER")!;
  const baseUrl = Deno.env.get("WPP_ORQUESTER_PROVIDER_URL")!;
  const path = Deno.env.get("WPP_ORQUESTER_PROVIDER_PATH")!;

  return {
    async sendMessage(to: string, text: string): Promise<void> {
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          const response = await fetch(`${baseUrl}${path}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-User-API-Key": apiKey,
            },
            body: JSON.stringify({ to_number: to, from_number: fromNumber, text }),
          });

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
    },
  };
}
