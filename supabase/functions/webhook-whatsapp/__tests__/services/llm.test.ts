// Tests del servicio LLM — prueban funciones reales importadas de llm.ts
//
// Cobertura:
//   resolveApiKey  — resolución de API key con fallback y error
//
// Nota: cleanResponse, parseOrderData y parseReservationData son funciones
// internas del módulo (no exportadas) y se prueban indirectamente a través
// de generateResponse en tests de integración.

import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  resolveApiKey,
} from "../../services/llm.ts";

// ---------------------------------------------------------------------------
// resolveApiKey
// ---------------------------------------------------------------------------

Deno.test("resolveApiKey - retorna clave específica del proveedor cuando está configurada", () => {
  Deno.env.set("LLM_API_KEY_OPENAI", "sk-openai-test-123");
  Deno.env.delete("LLM_API_KEY");
  try {
    const key = resolveApiKey("openai");
    assertEquals(key, "sk-openai-test-123");
  } finally {
    Deno.env.delete("LLM_API_KEY_OPENAI");
  }
});

Deno.test("resolveApiKey - usa LLM_API_KEY como fallback cuando no hay clave del proveedor", () => {
  Deno.env.delete("LLM_API_KEY_OPENAI");
  Deno.env.set("LLM_API_KEY", "sk-fallback-456");
  try {
    const key = resolveApiKey("openai");
    assertEquals(key, "sk-fallback-456");
  } finally {
    Deno.env.delete("LLM_API_KEY");
  }
});

Deno.test("resolveApiKey - prefiere clave del proveedor sobre el fallback", () => {
  Deno.env.set("LLM_API_KEY_OPENAI", "sk-specific");
  Deno.env.set("LLM_API_KEY", "sk-fallback");
  try {
    const key = resolveApiKey("openai");
    assertEquals(key, "sk-specific");
  } finally {
    Deno.env.delete("LLM_API_KEY_OPENAI");
    Deno.env.delete("LLM_API_KEY");
  }
});

Deno.test("resolveApiKey - lanza error cuando no hay ninguna clave configurada", () => {
  Deno.env.delete("LLM_API_KEY_OPENAI");
  Deno.env.delete("LLM_API_KEY");
  assertThrows(
    () => resolveApiKey("openai"),
    Error,
    "No API key found for provider: openai"
  );
});

Deno.test("resolveApiKey - el slug del proveedor se convierte a mayúsculas para buscar la env var", () => {
  Deno.env.set("LLM_API_KEY_ANTHROPIC", "sk-ant-test");
  Deno.env.delete("LLM_API_KEY");
  try {
    const key = resolveApiKey("anthropic");
    assertEquals(key, "sk-ant-test");
  } finally {
    Deno.env.delete("LLM_API_KEY_ANTHROPIC");
  }
});
