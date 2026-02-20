// Lead service - handles lead creation and updates

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Lead, Classification, BotPausedReason } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("lead");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/**
 * Find an existing lead by phone number
 */
export async function findLeadByPhone(phone: string): Promise<Lead | null> {
  const { data: lead } = await supabase
    .from("leads")
    .select()
    .eq("phone", phone)
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
  let lead = await findLeadByPhone(phone);

  if (!lead) {
    lead = await createLead(phone, clientId);
  } else if (lead.client_id !== clientId) {
    const { data: updatedLead, error } = await supabase
      .from("leads")
      .update({ client_id: clientId })
      .eq("id", lead.id)
      .select()
      .single();

    if (error) {
      logger.error("Error actualizando client_id del lead", { leadId: lead.id, clientId, error });
    } else if (updatedLead != null) {
      logger.info("Lead reasignado a nuevo cliente", { leadId: lead.id, clientId });
      lead = updatedLead as Lead;
    }
  }

  return lead;
}

/**
 * Update lead with classification data
 */
export async function updateLeadClassification(
  leadId: string,
  classification: Classification
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      classification: classification.classification,
      score: classification.score,
      extracted_data: classification.extracted,
    })
    .eq("id", leadId);

  if (error) {
    logger.error("Error actualizando clasificación del lead", { leadId, error });
    throw error;
  }

  logger.info("Clasificación actualizada", {
    leadId,
    classification: classification.classification,
    score: classification.score,
    reasoning: classification.reasoning,
  });
}

/**
 * Pausa el bot para un lead — el humano toma control.
 */
export async function pauseLead(
  leadId: string,
  reason: BotPausedReason
): Promise<void> {
  const { error } = await supabase
    .from("leads")
    .update({
      bot_paused: true,
      bot_paused_at: new Date().toISOString(),
      bot_paused_reason: reason,
    })
    .eq("id", leadId);

  if (error) {
    logger.error("Error pausando bot del lead", { leadId, reason, error });
    throw error;
  }

  logger.info("Bot pausado — humano en control", { leadId, reason });
}
