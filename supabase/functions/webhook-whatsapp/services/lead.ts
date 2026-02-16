// Lead service - handles lead creation and updates

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { Lead, Classification } from "../types/index.ts";

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
  name?: string
): Promise<Lead> {
  const { data: newLead, error } = await supabase
    .from("leads")
    .insert({
      phone,
      name: name || null,
    })
    .select()
    .single();

  if (error) {
    console.error("Error creando lead:", error);
    throw error;
  }

  return newLead;
}

/**
 * Get or create a lead by phone number
 */
export async function getOrCreateLead(
  phone: string,
  name?: string
): Promise<Lead> {
  let lead = await findLeadByPhone(phone);

  if (!lead) {
    lead = await createLead(phone, name);
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
      current_phase: "classified",
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId);

  if (error) {
    console.error("Error actualizando clasificación:", error);
    throw error;
  }

  console.log(
    `Lead clasificado: ${classification.classification} (${classification.score})`
  );
}
