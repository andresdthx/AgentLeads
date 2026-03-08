// Tests del servicio Intent — prueba hasProductKeywords (función pura exportada)
//
// hasProductKeywords es un pre-filtro de regex sin costo LLM.
// No toca Supabase ni APIs externas — es testeable directamente.
//
// Nota sobre la importación dinámica:
//   intent.ts instancia un cliente Supabase a nivel de módulo, por lo que
//   las env vars deben estar configuradas ANTES de que el módulo se inicialice.
//   La importación dinámica (await import) garantiza ese orden.

import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";

// Configurar env vars antes de que el módulo se inicialice
Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");

const { hasProductKeywords } = await import("../../services/intent.ts");

// ---------------------------------------------------------------------------
// Casos que SÍ deben detectar intención de producto
// ---------------------------------------------------------------------------

const shouldMatch: Array<[string, string]> = [
  ["talla", "necesito talla 42"],
  ["tallas", "¿qué tallas tienen disponibles?"],
  ["precio", "cuál es el precio de ese modelo"],
  ["precios", "me puedes dar los precios"],
  ["referencia", "busco la referencia 1234"],
  ["ref", "tengo la ref del producto"],
  ["modelo", "me interesa ese modelo"],
  ["color blanco", "quiero en color blanco"],
  ["color negro", "lo tienen en negro?"],
  ["color rojo", "lo tienen en rojo?"],
  ["color verde", "prefiero el verde"],
  ["color azul", "tienen en azul?"],
  ["color gris", "me gusta el gris"],
  ["color beige", "quiero el beige"],
  ["tienen", "tienen ese producto?"],
  ["hay", "hay stock disponible?"],
  ["stock", "hay stock de ese tenis?"],
  ["disponible", "está disponible ese color?"],
  ["catálogo", "me puedes compartir el catálogo"],
  ["foto", "me mandas una foto?"],
  ["fotos", "me puedes enviar fotos?"],
  ["imagen", "quiero ver una imagen"],
  ["imágenes", "me mandas imágenes?"],
  ["muestrame (sin acento — tal como está en la regex)", "muestrame los modelos"],
  ["muestra", "muestra lo que tienen"],
  ["ver", "quiero ver el producto"],
  ["quisiera", "quisiera ver el catálogo"],
  ["quiero", "quiero comprar uno"],
  ["busco", "busco unos tenis blancos"],
  ["necesito", "necesito tenis para correr"],
  ["estoy buscando", "estoy buscando unos Jordan"],
];

for (const [keyword, phrase] of shouldMatch) {
  Deno.test(`hasProductKeywords - detecta '${keyword}': "${phrase}"`, () => {
    assertEquals(hasProductKeywords(phrase), true);          // sin keywords → fallback global
    assertEquals(hasProductKeywords(phrase, []), true);      // array vacío → fallback global
  });
}

// ---------------------------------------------------------------------------
// Casos que NO deben activar el agente de intención
// ---------------------------------------------------------------------------

const shouldNotMatch: Array<[string, string]> = [
  ["saludo simple", "hola buenas tardes"],
  ["agradecimiento", "ok gracias"],
  ["confirmación", "perfecto"],
  ["horario", "cuál es el horario de atención?"],
  ["dirección", "cuál es la dirección de la tienda?"],
  ["whatsapp", "me dan el número de WhatsApp?"],
  ["mensaje vacío", ""],
  ["solo puntuación", "!!!"],
];

for (const [desc, phrase] of shouldNotMatch) {
  Deno.test(`hasProductKeywords - no detecta intención en '${desc}': "${phrase}"`, () => {
    assertEquals(hasProductKeywords(phrase), false);         // sin keywords → fallback global
    assertEquals(hasProductKeywords(phrase, []), false);     // array vacío → fallback global
  });
}

// ---------------------------------------------------------------------------
// Casos de borde
// ---------------------------------------------------------------------------

Deno.test("hasProductKeywords - es case-insensitive (mayúsculas)", () => {
  assertEquals(hasProductKeywords("BUSCO TENIS BLANCOS"), true);
});

Deno.test("hasProductKeywords - es case-insensitive (título)", () => {
  assertEquals(hasProductKeywords("Busco Tenis Blancos"), true);
});

Deno.test("hasProductKeywords - detecta tallas numéricas en contexto", () => {
  assertEquals(hasProductKeywords("lo tienen en talla 9?"), true);
});

Deno.test("hasProductKeywords - detecta 'catálogo' con tilde", () => {
  assertEquals(hasProductKeywords("mándame el catálogo"), true);
});

Deno.test("hasProductKeywords - detecta 'catalogo' sin tilde", () => {
  assertEquals(hasProductKeywords("mandame el catalogo"), true);
});

// ---------------------------------------------------------------------------
// Override por cliente (migration 045)
// ---------------------------------------------------------------------------

Deno.test("hasProductKeywords - override de cliente detecta keyword personalizada", () => {
  // Negocio de masajes: la regex global no detecta "masaje"
  assertEquals(hasProductKeywords("quiero un masaje relajante", []), false);
  // Con el override del cliente sí lo detecta
  assertEquals(hasProductKeywords("quiero un masaje relajante", ["masaje", "servicio", "reserva"]), true);
});

Deno.test("hasProductKeywords - override de cliente es case-insensitive", () => {
  assertEquals(hasProductKeywords("RESERVAR TURNO", ["masaje", "reservar", "turno"]), true);
});

Deno.test("hasProductKeywords - override de cliente no activa falsos positivos", () => {
  assertEquals(hasProductKeywords("hola buenas", ["masaje", "servicio", "reserva"]), false);
});

Deno.test("hasProductKeywords - override de cliente: saludo no activa cuando keywords son específicas", () => {
  // La palabra "ver" está en el fallback global pero no en este override específico
  assertEquals(hasProductKeywords("quiero ver el menú", ["masaje", "precio", "reservar"]), false);
});
