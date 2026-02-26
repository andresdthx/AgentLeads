// Notification service — alerts the sales agent when a lead is ready to buy.
//
// Currently sends a WhatsApp message to client.notification_phone.
// The call is fire-and-forget: failures are logged but never bubble up
// to the main pipeline so the prospect's experience is never affected.

import { sendWhatsAppMessage } from "./whatsapp.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("notification");

/**
 * Sends a WhatsApp alert to the client's sales agent when a lead
 * transitions to classification = "hot".
 *
 * @param notificationPhone - international format without + (e.g. "573001234567")
 * @param leadPhone         - the prospect's phone number (for identification)
 * @param leadId            - UUID of the lead (for the dashboard deep-link)
 */
export async function notifyHotLead(
  notificationPhone: string,
  leadPhone: string,
  leadId: string
): Promise<void> {
  const message =
    `🔥 *Lead listo para comprar*\n\n` +
    `El prospecto *${leadPhone}* ha alcanzado una alta intención de compra.\n\n` +
    `Entra al dashboard para tomar el control de la conversación:\n` +
    `Lead ID: ${leadId}`;

  try {
    await sendWhatsAppMessage(notificationPhone, message);
    logger.info("Notificación hot lead enviada al agente", { notificationPhone, leadPhone, leadId });
  } catch (err) {
    // Never throw — a notification failure must not block the main flow.
    logger.error("Fallo al enviar notificación hot lead al agente", {
      notificationPhone,
      leadPhone,
      leadId,
      error: String(err),
    });
  }
}
