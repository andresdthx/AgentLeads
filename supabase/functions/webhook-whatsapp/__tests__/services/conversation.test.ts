// Tests del mock de infraestructura para el servicio Conversation
//
// ⚠️  Estos tests prueban el createMockSupabaseClient de helpers/mocks.ts,
//     NO los servicios reales (saveUserMessage, saveBotResponse, getConversationHistory).
//     conversation.ts usa RPCs de Supabase directamente y no es inyectable
//     hasta implementar Repository Pattern.
//
//     Valor actual: verifican el comportamiento del mock y documentan
//     los contratos esperados del servicio para implementación futura.

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createMockSupabaseClient, createTestMessage } from "../helpers/mocks.ts";

Deno.test("Conversation Service - Save message", async () => {
  const mockClient = createMockSupabaseClient();
  const message = createTestMessage({
    lead_id: "test-lead-id",
    role: "user",
    content: "Hello, I need a website",
  });

  await mockClient.from("messages").insert(message);

  const messages = mockClient._getData("messages");
  assertEquals(messages.length, 1);
  assertEquals(messages[0].lead_id, "test-lead-id");
  assertEquals(messages[0].role, "user");
  assertEquals(messages[0].content, "Hello, I need a website");
});

Deno.test("Conversation Service - Save user message", async () => {
  const mockClient = createMockSupabaseClient();
  const leadId = "test-lead-id";
  const content = "I need help with my project";

  await mockClient.from("messages").insert({
    lead_id: leadId,
    role: "user",
    content,
  });

  const messages = mockClient._getData("messages");
  assertEquals(messages.length, 1);
  assertEquals(messages[0].role, "user");
  assertEquals(messages[0].content, content);
});

Deno.test("Conversation Service - Save assistant message", async () => {
  const mockClient = createMockSupabaseClient();
  const leadId = "test-lead-id";
  const content = "I'd be happy to help! What kind of project?";

  await mockClient.from("messages").insert({
    lead_id: leadId,
    role: "assistant",
    content,
  });

  const messages = mockClient._getData("messages");
  assertEquals(messages.length, 1);
  assertEquals(messages[0].role, "assistant");
  assertEquals(messages[0].content, content);
});

Deno.test("Conversation Service - Get conversation history", async () => {
  const mockClient = createMockSupabaseClient();
  const leadId = "test-lead-id";

  const testMessages = [
    createTestMessage({ lead_id: leadId, role: "user", content: "Hello" }),
    createTestMessage({ lead_id: leadId, role: "assistant", content: "Hi there!" }),
    createTestMessage({ lead_id: leadId, role: "user", content: "I need a website" }),
  ];

  mockClient._seed("messages", testMessages);

  // Note: Our mock doesn't fully support chaining, so we'll test the concept
  const messages = mockClient._getData("messages");

  assertEquals(messages.length, 3);
  assertEquals(messages[0].content, "Hello");
  assertEquals(messages[1].content, "Hi there!");
  assertEquals(messages[2].content, "I need a website");
});

Deno.test("Conversation Service - History respects limit", async () => {
  const mockClient = createMockSupabaseClient();
  const leadId = "test-lead-id";

  // Create 15 messages
  const testMessages = Array.from({ length: 15 }, (_, i) =>
    createTestMessage({
      lead_id: leadId,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `Message ${i + 1}`,
    })
  );

  mockClient._seed("messages", testMessages);

  // Get only last 10 messages
  const limit = 10;
  const messages = mockClient._getData("messages").slice(-limit);

  assertEquals(messages.length, 10);
  assertEquals(messages[0].content, "Message 6");
  assertEquals(messages[9].content, "Message 15");
});

Deno.test("Conversation Service - Alternating user and assistant messages", async () => {
  const mockClient = createMockSupabaseClient();
  const leadId = "test-lead-id";

  const conversation = [
    { role: "user", content: "Hello" },
    { role: "assistant", content: "Hi! How can I help?" },
    { role: "user", content: "I need a website" },
    { role: "assistant", content: "Great! What type of website?" },
    { role: "user", content: "E-commerce" },
  ];

  for (const msg of conversation) {
    await mockClient.from("messages").insert({
      lead_id: leadId,
      role: msg.role,
      content: msg.content,
    });
  }

  const messages = mockClient._getData("messages");

  assertEquals(messages.length, 5);
  assertEquals(messages[0].role, "user");
  assertEquals(messages[1].role, "assistant");
  assertEquals(messages[2].role, "user");
  assertEquals(messages[3].role, "assistant");
  assertEquals(messages[4].role, "user");
});

Deno.test("Conversation Service - Multiple leads have separate histories", async () => {
  const mockClient = createMockSupabaseClient();
  const lead1Id = "lead-1";
  const lead2Id = "lead-2";

  const lead1Messages = [
    createTestMessage({ lead_id: lead1Id, content: "Lead 1 message 1" }),
    createTestMessage({ lead_id: lead1Id, content: "Lead 1 message 2" }),
  ];

  const lead2Messages = [
    createTestMessage({ lead_id: lead2Id, content: "Lead 2 message 1" }),
  ];

  mockClient._seed("messages", [...lead1Messages, ...lead2Messages]);

  const allMessages = mockClient._getData("messages");
  const lead1Msgs = allMessages.filter((m: any) => m.lead_id === lead1Id);
  const lead2Msgs = allMessages.filter((m: any) => m.lead_id === lead2Id);

  assertEquals(lead1Msgs.length, 2);
  assertEquals(lead2Msgs.length, 1);
  assertEquals(lead1Msgs[0].content, "Lead 1 message 1");
  assertEquals(lead2Msgs[0].content, "Lead 2 message 1");
});

Deno.test("Conversation Service - Empty history for new lead", async () => {
  const mockClient = createMockSupabaseClient();
  const leadId = "new-lead-id";

  const messages = mockClient._getData("messages").filter(
    (m: any) => m.lead_id === leadId
  );

  assertEquals(messages.length, 0);
});

Deno.test("Conversation Service - Message content preserves formatting", async () => {
  const mockClient = createMockSupabaseClient();
  const leadId = "test-lead-id";
  const multilineContent = `Hello!

This is a message with:
- Multiple lines
- Bullet points
- Special characters: @#$%

Best regards`;

  await mockClient.from("messages").insert({
    lead_id: leadId,
    role: "user",
    content: multilineContent,
  });

  const messages = mockClient._getData("messages");
  assertEquals(messages[0].content, multilineContent);
});
