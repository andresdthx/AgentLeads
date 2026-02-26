// Tests del mock de infraestructura para el servicio Lead
//
// ⚠️  Estos tests prueban el createMockSupabaseClient de helpers/mocks.ts,
//     NO los servicios reales (getOrCreateLead, pauseLead, saveOrderData).
//     lead.ts instancia su propio cliente de Supabase internamente, por lo
//     que no es inyectable hasta implementar Repository Pattern.
//
//     Valor actual: verifican que el mock se comporta correctamente,
//     sirviendo como contrato de referencia para tests futuros.

import {
  assertEquals,
  assertExists,
  assert,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createMockSupabaseClient, createTestLead, createTestClassification } from "../helpers/mocks.ts";

Deno.test("Lead Service - Find lead by phone", async () => {
  const mockClient = createMockSupabaseClient();
  const testLead = createTestLead({ phone: "+1234567890" });

  // Seed the mock database
  mockClient._seed("leads", [testLead]);

  // Simulate findLeadByPhone
  const { data: lead } = await mockClient
    .from("leads")
    .select()
    .eq("phone", "+1234567890")
    .single();

  assertExists(lead);
  assertEquals(lead.phone, "+1234567890");
  assertEquals(lead.id, testLead.id);
});

Deno.test("Lead Service - Find lead returns null when not found", async () => {
  const mockClient = createMockSupabaseClient();

  const { data: lead } = await mockClient
    .from("leads")
    .select()
    .eq("phone", "+9999999999")
    .single();

  assertEquals(lead, null);
});

Deno.test("Lead Service - Create new lead", async () => {
  const mockClient = createMockSupabaseClient();

  const { data: newLead } = await mockClient
    .from("leads")
    .insert({
      phone: "+1234567890",
      name: "John Doe",
    })
    .select()
    .single();

  assertExists(newLead);
  assertEquals(newLead.phone, "+1234567890");
  assertEquals(newLead.name, "John Doe");
  assertExists(newLead.id);
});

Deno.test("Lead Service - Create lead without name", async () => {
  const mockClient = createMockSupabaseClient();

  const { data: newLead } = await mockClient
    .from("leads")
    .insert({
      phone: "+1234567890",
      name: null,
    })
    .select()
    .single();

  assertExists(newLead);
  assertEquals(newLead.phone, "+1234567890");
  assertEquals(newLead.name, null);
});

Deno.test("Lead Service - Update lead classification", async () => {
  const mockClient = createMockSupabaseClient();
  const testLead = createTestLead({ phone: "+1234567890" });
  const classification = createTestClassification({
    score: 85,
    classification: "hot",
  });

  mockClient._seed("leads", [testLead]);

  // Update the lead
  await mockClient
    .from("leads")
    .update({
      classification: classification.classification,
      score: classification.score,
      extracted_data: classification.extracted,
      current_phase: "classified",
      updated_at: new Date().toISOString(),
    })
    .eq("id", testLead.id);

  // Verify the update
  const leads = mockClient._getData("leads");
  const updatedLead = leads[0];

  assertEquals(updatedLead.classification, "hot");
  assertEquals(updatedLead.score, 85);
  assertEquals(updatedLead.current_phase, "classified");
  assertExists(updatedLead.extracted_data);
  assertExists(updatedLead.updated_at);
});

Deno.test("Lead Service - Get or create lead (existing)", async () => {
  const mockClient = createMockSupabaseClient();
  const existingLead = createTestLead({ phone: "+1234567890" });

  mockClient._seed("leads", [existingLead]);

  // Try to get or create
  const { data: lead } = await mockClient
    .from("leads")
    .select()
    .eq("phone", "+1234567890")
    .single();

  assertExists(lead);
  assertEquals(lead.id, existingLead.id);
  assertEquals(lead.phone, "+1234567890");

  // Should not create a new lead
  const allLeads = mockClient._getData("leads");
  assertEquals(allLeads.length, 1);
});

Deno.test("Lead Service - Get or create lead (new)", async () => {
  const mockClient = createMockSupabaseClient();

  // Try to find (should return null)
  const { data: existingLead } = await mockClient
    .from("leads")
    .select()
    .eq("phone", "+1234567890")
    .single();

  assertEquals(existingLead, null);

  // Create new lead
  const { data: newLead } = await mockClient
    .from("leads")
    .insert({
      phone: "+1234567890",
      name: "Jane Doe",
    })
    .select()
    .single();

  assertExists(newLead);
  assertEquals(newLead.phone, "+1234567890");

  // Verify it was added
  const allLeads = mockClient._getData("leads");
  assertEquals(allLeads.length, 1);
});

Deno.test("Lead Service - Classification with extracted data", async () => {
  const mockClient = createMockSupabaseClient();
  const testLead = createTestLead();
  const classification = createTestClassification({
    extracted: {
      need: "website redesign",
      timeline: "3 months",
      budget: "$15000",
      authority: "decision maker",
    },
  });

  mockClient._seed("leads", [testLead]);

  await mockClient
    .from("leads")
    .update({
      classification: classification.classification,
      score: classification.score,
      extracted_data: classification.extracted,
    })
    .eq("id", testLead.id);

  const leads = mockClient._getData("leads");
  const updatedLead = leads[0];

  assertEquals(updatedLead.extracted_data.need, "website redesign");
  assertEquals(updatedLead.extracted_data.timeline, "3 months");
  assertEquals(updatedLead.extracted_data.budget, "$15000");
  assertEquals(updatedLead.extracted_data.authority, "decision maker");
});

Deno.test("Lead Service - Multiple leads with different phones", async () => {
  const mockClient = createMockSupabaseClient();
  const lead1 = createTestLead({ phone: "+1111111111" });
  const lead2 = createTestLead({ phone: "+2222222222" });

  mockClient._seed("leads", [lead1, lead2]);

  const { data: foundLead1 } = await mockClient
    .from("leads")
    .select()
    .eq("phone", "+1111111111")
    .single();

  const { data: foundLead2 } = await mockClient
    .from("leads")
    .select()
    .eq("phone", "+2222222222")
    .single();

  assertExists(foundLead1);
  assertExists(foundLead2);
  assertEquals(foundLead1.phone, "+1111111111");
  assertEquals(foundLead2.phone, "+2222222222");
  assert(foundLead1.id !== foundLead2.id);
});
