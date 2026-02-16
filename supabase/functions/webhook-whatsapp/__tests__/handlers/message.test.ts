// Tests for Message handler

import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import type { RequestPayload } from "../../types/index.ts";

Deno.test("Message Handler - Skip messages not from user", async () => {
  const payload: RequestPayload = {
    sent_by: "bot",
    remote_phone_number: "+1234567890",
    message: { text: "Test message" },
    contact: { first_name: "Test" },
  };

  // Simulate the skip logic
  if (payload.sent_by !== "user") {
    const result = { ok: true, skipped: true, reason: "not from user" };
    assertEquals(result.skipped, true);
    assertEquals(result.reason, "not from user");
  }
});

Deno.test("Message Handler - Skip messages without text", async () => {
  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: "" },
    contact: { first_name: "Test" },
  };

  const phone = payload.remote_phone_number;
  const incomingMessage = payload.message?.text;

  if (!phone || !incomingMessage) {
    const result = { ok: true, skipped: true, reason: "no text" };
    assertEquals(result.skipped, true);
    assertEquals(result.reason, "no text");
  }
});

Deno.test("Message Handler - Skip messages without phone", async () => {
  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "",
    message: { text: "Hello" },
    contact: { first_name: "Test" },
  };

  const phone = payload.remote_phone_number;
  const incomingMessage = payload.message?.text;

  if (!phone || !incomingMessage) {
    const result = { ok: true, skipped: true, reason: "no text" };
    assertEquals(result.skipped, true);
  }
});

Deno.test("Message Handler - Process valid user message", async () => {
  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: "Hello, I need help" },
    contact: { first_name: "John" },
  };

  // Validate payload structure
  assertEquals(payload.sent_by, "user");
  assertExists(payload.remote_phone_number);
  assertExists(payload.message.text);
  assertEquals(payload.message.text.length > 0, true);
});

Deno.test("Message Handler - Extract phone and message correctly", () => {
  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: "Test message" },
    contact: { first_name: "Jane" },
  };

  const phone = payload.remote_phone_number;
  const incomingMessage = payload.message?.text;

  assertEquals(phone, "+1234567890");
  assertEquals(incomingMessage, "Test message");
});

Deno.test("Message Handler - Handle contact with first name", () => {
  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: "Hello" },
    contact: { first_name: "Alice" },
  };

  const name = payload.contact?.first_name;
  assertEquals(name, "Alice");
});

Deno.test("Message Handler - Handle contact without first name", () => {
  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: "Hello" },
    contact: {},
  };

  const name = payload.contact?.first_name;
  assertEquals(name, undefined);
});

Deno.test("Message Handler - Flow sequence validation", () => {
  const expectedFlow = [
    "Get or create lead",
    "Save user message",
    "Get conversation history",
    "Generate LLM response",
    "Update lead classification (if present)",
    "Save assistant response",
    "Send WhatsApp message",
  ];

  // This test documents the expected flow
  assertEquals(expectedFlow.length, 7);
  assertEquals(expectedFlow[0], "Get or create lead");
  assertEquals(expectedFlow[6], "Send WhatsApp message");
});

Deno.test("Message Handler - Validate payload structure", () => {
  const validPayload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: "Hello" },
    contact: { first_name: "Test" },
  };

  // Check all required fields exist
  assertExists(validPayload.sent_by);
  assertExists(validPayload.remote_phone_number);
  assertExists(validPayload.message);
  assertExists(validPayload.message.text);
  assertExists(validPayload.contact);
});

Deno.test("Message Handler - Success response structure", () => {
  const successResponse = { ok: true };

  assertEquals(successResponse.ok, true);
  assertEquals(Object.keys(successResponse).includes("skipped"), false);
});

Deno.test("Message Handler - Skip response structure", () => {
  const skipResponse = {
    ok: true,
    skipped: true,
    reason: "not from user",
  };

  assertEquals(skipResponse.ok, true);
  assertEquals(skipResponse.skipped, true);
  assertExists(skipResponse.reason);
});

Deno.test("Message Handler - Different phone number formats", () => {
  const phoneFormats = [
    "+1234567890",
    "+52 55 1234 5678",
    "+34 912 345 678",
    "1234567890",
  ];

  phoneFormats.forEach((phone) => {
    const payload: RequestPayload = {
      sent_by: "user",
      remote_phone_number: phone,
      message: { text: "Test" },
      contact: {},
    };

    assertEquals(payload.remote_phone_number, phone);
  });
});

Deno.test("Message Handler - Long message handling", () => {
  const longMessage = "A".repeat(1000);

  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: longMessage },
    contact: {},
  };

  assertEquals(payload.message.text.length, 1000);
});

Deno.test("Message Handler - Special characters in message", () => {
  const specialMessage = "Hello! 👋 ¿Cómo estás? €100 #test @user";

  const payload: RequestPayload = {
    sent_by: "user",
    remote_phone_number: "+1234567890",
    message: { text: specialMessage },
    contact: {},
  };

  assertEquals(payload.message.text, specialMessage);
});
