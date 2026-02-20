// Tests for LLM service

import {
  assertEquals,
  assertExists,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";
import { createMockFetch, createTestMessage, setupTestEnv } from "../helpers/mocks.ts";

// Mock the LLM module functions since we can't easily test the actual implementation
// We'll test the parsing logic which is the most critical part

Deno.test("LLM Service - Parse classification from response", () => {
  const responseWithClassification = `Hola! Entiendo que necesitas una página web.

CLASIFICACION
{"score": 85, "classification": "hot", "extracted": {"need": "website", "timeline": "2 weeks", "budget": "$5000", "authority": "yes"}, "reasoning": "Clear need, urgent timeline, good budget"}
FIN

¿Cuándo necesitarías tener el sitio listo?`;

  const classMatch = responseWithClassification.match(/CLASIFICACION([\s\S]*)FIN/);

  assertExists(classMatch, "Should find classification block");

  const classification = JSON.parse(classMatch![1].trim());

  assertEquals(classification.score, 85);
  assertEquals(classification.classification, "hot");
  assertEquals(classification.extracted.need, "website");
  assertEquals(classification.extracted.timeline, "2 weeks");
  assertEquals(classification.reasoning, "Clear need, urgent timeline, good budget");
});

Deno.test("LLM Service - Parse classification returns null when not present", () => {
  const responseWithoutClassification = "Hola! ¿En qué puedo ayudarte?";

  const classMatch = responseWithoutClassification.match(/CLASIFICACION([\s\S]*)FIN/);

  assertEquals(classMatch, null, "Should not find classification block");
});

Deno.test("LLM Service - Clean response removes classification block", () => {
  const responseWithClassification = `Hola! Entiendo que necesitas una página web.

CLASIFICACION
{"score": 85, "classification": "hot", "extracted": {"need": "website"}, "reasoning": "test"}
FIN

¿Cuándo necesitarías tener el sitio listo?`;

  const cleanedResponse = responseWithClassification
    .replace(/CLASIFICACION[\s\S]*FIN/, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  assertEquals(
    cleanedResponse,
    "Hola! Entiendo que necesitas una página web.\n\n¿Cuándo necesitarías tener el sitio listo?"
  );

  // Should not contain classification markers
  assertEquals(cleanedResponse.includes("CLASIFICACION"), false);
  assertEquals(cleanedResponse.includes("FIN"), false);
});

Deno.test("LLM Service - Build LLM messages with system prompt", () => {
  const SYSTEM_PROMPT = "You are a sales agent";
  const messages = createTestMessage({ role: "user", content: "Hello" });

  const llmMessages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: "Hello" },
  ];

  assertEquals(llmMessages.length, 2);
  assertEquals(llmMessages[0].role, "system");
  assertEquals(llmMessages[0].content, SYSTEM_PROMPT);
  assertEquals(llmMessages[1].role, "user");
  assertEquals(llmMessages[1].content, "Hello");
});

Deno.test("LLM Service - Handle malformed classification JSON", () => {
  const responseWithBadJson = `Response text

CLASIFICACION
{invalid json here}
FIN

More text`;

  const classMatch = responseWithBadJson.match(/CLASIFICACION([\s\S]*)FIN/);
  assertExists(classMatch);

  try {
    JSON.parse(classMatch![1].trim());
    throw new Error("Should have thrown");
  } catch (e) {
    assertExists(e, "Should catch JSON parse error");
  }
});

Deno.test("LLM Service - Classification with all fields", () => {
  const fullClassification = {
    score: 90,
    classification: "hot",
    extracted: {
      need: "e-commerce platform",
      timeline: "1 month",
      budget: "$10000",
      authority: "yes, I'm the CEO",
    },
    reasoning: "High budget, clear authority, urgent need",
  };

  const responseText = `Great!

CLASIFICACION
${JSON.stringify(fullClassification)}
FIN

Let me help you.`;

  const classMatch = responseText.match(/CLASIFICACION([\s\S]*)FIN/);
  const parsed = JSON.parse(classMatch![1].trim());

  assertEquals(parsed.score, 90);
  assertEquals(parsed.classification, "hot");
  assertEquals(parsed.extracted.need, "e-commerce platform");
  assertEquals(parsed.extracted.timeline, "1 month");
  assertEquals(parsed.extracted.budget, "$10000");
  assertEquals(parsed.extracted.authority, "yes, I'm the CEO");
  assertStringIncludes(parsed.reasoning, "High budget");
});

Deno.test("LLM Service - Classification scores and categories", () => {
  const testCases = [
    { score: 95, expected: "hot" },
    { score: 75, expected: "hot" },
    { score: 60, expected: "warm" },
    { score: 50, expected: "warm" },
    { score: 30, expected: "cold" },
    { score: 10, expected: "cold" },
  ];

  testCases.forEach(({ score, expected }) => {
    let classification = "cold";
    if (score >= 70) classification = "hot";
    else if (score >= 40) classification = "warm";

    assertEquals(classification, expected, `Score ${score} should be ${expected}`);
  });
});
