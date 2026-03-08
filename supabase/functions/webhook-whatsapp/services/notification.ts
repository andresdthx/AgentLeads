// Notification service — alerts the sales agent when a lead is ready to buy.
//
// Currently sends a WhatsApp message to client.notification_phone.
// The call is fire-and-forget: failures are logged but never bubble up
// to the main pipeline so the prospect's experience is never affected.

import type { WhatsAppProvider, HandoffMode } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("notification");

/**
 * Sends a WhatsApp alert to the client's sales agent when a lead
 * transitions to classification = "hot".
 *
 * @param provider          - WhatsApp provider del canal activo (multi-tenant)
 * @param notificationPhone - international format without + (e.g. "573001234567")
 * @param leadPhone         - the prospect's phone number (for identification)
 * @param leadId            - UUID of the lead (for the dashboard deep-link)
 * @param confirmed         - true when the lead confirmed a purchase/reservation (score=100)
 */
export async function notifyHotLead(
  provider: WhatsAppProvider,
  notificationPhone: string,
  leadPhone: string,
  leadId: string,
  confirmed = false
): Promise<void> {
  const message = confirmed
    ? `✅ *Pedido confirmado — acción inmediata requerida*\n\n` +
      `El prospecto *${leadPhone}* confirmó su compra/reserva.\n\n` +
      `Entra al dashboard para cerrar la venta:\n` +
      `Lead ID: ${leadId}`
    : `🔥 *Lead listo para comprar*\n\n` +
      `El prospecto *${leadPhone}* ha alcanzado una alta intención de compra.\n\n` +
      `Entra al dashboard para tomar el control de la conversación:\n` +
      `Lead ID: ${leadId}`;

  try {
    await provider.sendMessage(notificationPhone, message);
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

/**
 * Sends a WhatsApp alert to the sales agent when a handoff is triggered.
 * Called for all non-technical pauses (requested + urgent) that have a notification phone.
 *
 * Urgent handoffs   → "✅ ACCIÓN REQUERIDA" prefix
 * Requested handoffs → "📋 Atención solicitada" prefix
 *
 * Fire-and-forget: failures are logged but never propagate.
 *
 * @param provider          - WhatsApp provider del canal activo
 * @param notificationPhone - international format without + (e.g. "573001234567")
 * @param leadPhone         - the prospect's phone number
 * @param leadId            - UUID of the lead (for dashboard deep-link)
 * @param handoffMode       - semantic urgency level
 * @param context           - optional free-text reason (from HANDOFF_INICIO block or derived)
 */
export async function notifyHandoff(
  provider: WhatsAppProvider,
  notificationPhone: string,
  leadPhone: string,
  leadId: string,
  handoffMode: HandoffMode,
  context?: string
): Promise<void> {
  const prefix = handoffMode === "urgent"
    ? "✅ *ACCIÓN REQUERIDA*"
    : "📋 *Atención solicitada*";

  const motivoLine = context ? `Motivo: ${context}\n` : "";

  const message =
    `${prefix}\n\n` +
    `${motivoLine}` +
    `Prospecto: *${leadPhone}*\n\n` +
    `Entra al dashboard para tomar control:\n` +
    `Lead ID: ${leadId}`;

  try {
    await provider.sendMessage(notificationPhone, message);
    logger.info("Notificación de handoff enviada al agente", {
      notificationPhone,
      leadPhone,
      leadId,
      handoffMode,
    });
  } catch (err) {
    logger.error("Fallo al enviar notificación de handoff", {
      notificationPhone,
      leadPhone,
      leadId,
      handoffMode,
      error: String(err),
    });
  }
}
