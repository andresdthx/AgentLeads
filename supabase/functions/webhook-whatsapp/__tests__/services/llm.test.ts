// Tests del servicio LLM — prueban funciones reales importadas de llm.ts
//
// Cobertura:
//   resolveApiKey  — resolución de API key con fallback y error
//   cleanResponse  — limpieza del texto de respuesta del LLM
//   parseOrderData — parseo del bloque de pedido estructurado

import {
  assertEquals,
  assertExists,
  assertThrows,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import {
  resolveApiKey,
  cleanResponse,
  parseOrderData,
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

// ---------------------------------------------------------------------------
// cleanResponse
// ---------------------------------------------------------------------------

Deno.test("cleanResponse - elimina el bloque CLASIFICACION...FIN", () => {
  const input =
    "Hola! Te puedo ayudar.\n\nCLASIFICACION\n{\"score\": 85}\nFIN\n\n¿Qué necesitas?";
  const result = cleanResponse(input);
  assertEquals(result, "Hola! Te puedo ayudar.\n\n¿Qué necesitas?");
});

Deno.test("cleanResponse - elimina el bloque PEDIDO_INICIO...PEDIDO_FIN", () => {
  const input =
    "Perfecto, tu pedido está listo.\n\nPEDIDO_INICIO\n{\"pedido_confirmado\": true}\nPEDIDO_FIN\n\nGracias por tu compra.";
  const result = cleanResponse(input);
  assertEquals(result, "Perfecto, tu pedido está listo.\n\nGracias por tu compra.");
});

Deno.test("cleanResponse - colapsa saltos de línea excesivos en máximo dos", () => {
  const input = "Línea 1\n\n\n\n\nLínea 2";
  const result = cleanResponse(input);
  assertEquals(result, "Línea 1\n\nLínea 2");
});

Deno.test("cleanResponse - no modifica texto sin bloques especiales", () => {
  const input = "Hola! ¿En qué te puedo ayudar hoy?";
  const result = cleanResponse(input);
  assertEquals(result, input);
});

Deno.test("cleanResponse - elimina ambos bloques cuando están presentes", () => {
  const input =
    "Respuesta.\n\nCLASIFICACION\n{}\nFIN\n\nPEDIDO_INICIO\n{}\nPEDIDO_FIN\n\nFin.";
  const result = cleanResponse(input);
  assertEquals(result, "Respuesta.\n\nFin.");
});

Deno.test("cleanResponse - aplica trim al resultado", () => {
  const input = "\n\nHola!\n\n";
  const result = cleanResponse(input);
  assertEquals(result, "Hola!");
});

// ---------------------------------------------------------------------------
// parseOrderData
// ---------------------------------------------------------------------------

Deno.test("parseOrderData - retorna null cuando no hay bloque PEDIDO", () => {
  const result = parseOrderData("Texto normal sin pedido.");
  assertEquals(result, null);
});

Deno.test("parseOrderData - parsea un bloque de pedido válido", () => {
  const orderPayload = {
    pedido_confirmado: true,
    ciudad_envio: "Bogotá",
    tipo_cliente: "detal",
    items: [{ producto: "Nike Air Force 1", talla: "42", cantidad: 1 }],
  };
  const input = `Ok, procesado.\n\nPEDIDO_INICIO\n${JSON.stringify(orderPayload)}\nPEDIDO_FIN`;

  const result = parseOrderData(input);

  assertExists(result);
  assertEquals(result!.pedido_confirmado, true);
  assertEquals(result!.ciudad_envio, "Bogotá");
  assertEquals(result!.tipo_cliente, "detal");
  assertEquals(result!.items.length, 1);
  assertEquals(result!.items[0].talla, "42");
});

Deno.test("parseOrderData - retorna null cuando pedido_confirmado es false", () => {
  const orderPayload = {
    pedido_confirmado: false,
    ciudad_envio: null,
    tipo_cliente: null,
    items: [],
  };
  const input = `PEDIDO_INICIO\n${JSON.stringify(orderPayload)}\nPEDIDO_FIN`;

  const result = parseOrderData(input);
  assertEquals(result, null);
});

Deno.test("parseOrderData - retorna null cuando items no es un array", () => {
  const orderPayload = { pedido_confirmado: true, items: null };
  const input = `PEDIDO_INICIO\n${JSON.stringify(orderPayload)}\nPEDIDO_FIN`;

  const result = parseOrderData(input);
  assertEquals(result, null);
});

Deno.test("parseOrderData - retorna null cuando el JSON está malformado", () => {
  const input = "PEDIDO_INICIO\n{json inválido aquí\nPEDIDO_FIN";
  const result = parseOrderData(input);
  assertEquals(result, null);
});

Deno.test("parseOrderData - maneja múltiples items correctamente", () => {
  const orderPayload = {
    pedido_confirmado: true,
    ciudad_envio: "Medellín",
    tipo_cliente: "mayorista",
    items: [
      { producto: "Nike Air Max", talla: "40", cantidad: 2 },
      { producto: "Adidas Stan Smith", talla: "42", cantidad: 1 },
    ],
  };
  const input = `PEDIDO_INICIO\n${JSON.stringify(orderPayload)}\nPEDIDO_FIN`;

  const result = parseOrderData(input);

  assertExists(result);
  assertEquals(result!.items.length, 2);
  assertEquals(result!.tipo_cliente, "mayorista");
});
