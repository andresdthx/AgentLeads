// Lead service - handles lead creation and updates

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Lead, OrderData, ReservationData, BotPausedReason, HandoffMode } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("lead");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * Find an existing lead by phone number scoped to a client
 */
export async function findLeadByPhone(phone: string, clientId: string): Promise<Lead | null> {
  const { data: lead } = await supabase
    .from("leads")
    .select()
    .eq("phone", phone)
    .eq("client_id", clientId)
    .single();

  return lead;
}

/**
 * Create a new lead
 */
export async function createLead(
  phone: string,
  clientId: string
): Promise<Lead> {
  const { data: newLead, error } = await supabase
    .from("leads")
    .insert({
      phone,
      client_id: clientId,
    })
    .select()
    .single();

  if (error) {
    logger.error("Error creando lead", { phone, clientId, error });
    throw error;
  }

  logger.info("Lead creado", { leadId: newLead.id, phone, clientId });
  return newLead;
}

/**
 * Get or create a lead by phone number
 */
export async function getOrCreateLead(
  phone: string,
  clientId: string
): Promise<Lead> {
  let lead = await findLeadByPhone(phone, clientId);

  if (!lead) {
    lead = await createLead(phone, clientId);
  }

  return lead;
}

/**
 * Guarda los datos del pedido confirmado en el lead.
 */
export async function saveOrderData(
  leadId: string,
  orderData: OrderData
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      order_data: orderData,
      order_confirmed_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) {
    logger.error("Error guardando datos del pedido", { leadId, error });
    throw error;
  }

  logger.info("Pedido confirmado guardado", { leadId, orderData });
}

/** Maps each BotPausedReason to its semantic HandoffMode. */
const REASON_TO_HANDOFF_MODE: Record<BotPausedReason, HandoffMode> = {
  // Technical — automatic system pause, low urgency
  "no_catalog":            "technical",
  "out_of_stock":          "technical",
  "config_error":          "technical",
  // Requested — explicit handoff, human should attend
  "needs_images":          "requested",
  "vision_low_conf":       "requested",
  "no_catalog_match":      "requested",
  "llm_handoff":           "requested",
  // Urgent — immediate human action required
  "order_confirmed":       "urgent",
  "reservation_confirmed": "urgent",
  "llm_handoff_urgent":    "urgent",
  // Deprecated — backward compat with existing DB rows
  "human_takeover":        "requested",
  "domicilio_exception":   "requested",
};

/**
 * Pausa el bot para un lead y registra el handoff_mode semántico.
 * Retorna el HandoffMode resuelto para que el caller decida si notificar.
 *
 * Reemplaza a pauseLead(). Use pauseLead() solo en código legado.
 */
export async function pauseLeadWithHandoff(
  leadId: string,
  reason: BotPausedReason,
  handoffReason?: string
): Promise<HandoffMode> {
  const handoffMode = REASON_TO_HANDOFF_MODE[reason] ?? "requested";
  const status = reason === "order_confirmed" ? "resolved" : "human_active";

  const { error } = await supabase
    .from("leads")
    .update({
      bot_paused: true,
      bot_paused_at: new Date().toISOString(),
      bot_paused_reason: reason,
      status,
      handoff_mode: handoffMode,
      handoff_reason: handoffReason ?? null,
    })
    .eq("id", leadId);

  if (error) {
    logger.error("Error pausando bot del lead", { leadId, reason, handoffMode, error });
    throw error;
  }

  logger.info("Bot pausado — humano en control", { leadId, reason, handoffMode, status });
  return handoffMode;
}

/**
 * @deprecated Usar pauseLeadWithHandoff() — no registra handoff_mode en BD.
 * Mantenido como wrapper para backward compat.
 */
export async function pauseLead(
  leadId: string,
  reason: BotPausedReason
): Promise<void> {
  await pauseLeadWithHandoff(leadId, reason);
}
