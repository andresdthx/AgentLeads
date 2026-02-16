// WhatsApp service - handles sending messages via 2chat

const TWOCHAT_API_KEY = Deno.env.get("TWOCHAT_API_KEY")!;
const TWOCHAT_FROM = Deno.env.get("TWOCHAT_FROM_NUMBER")!;
const WPP_ORQUESTER_PROVIDER_URL = Deno.env.get("WPP_ORQUESTER_PROVIDER_URL")!;
const WPP_ORQUESTER_PROVIDER_PATH = Deno.env.get("WPP_ORQUESTER_PROVIDER_PATH")!;

/**
 * Send a WhatsApp message via 2chat API
 */
export async function sendWhatsAppMessage(
  to: string,
  text: string
): Promise<void> {
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
  console.log("Respuesta enviada:", JSON.stringify(data));

  if (!response.ok) {
    console.error("Error enviando mensaje:", data);
    throw new Error("Failed to send WhatsApp message");
  }
}
