// Tests del servicio Notification — prueba notifyHotLead con provider mockeado
//
// Tras el refactoring, notifyHotLead recibe el WhatsAppProvider por inyección,
// lo que permite testearlo sin Supabase ni red. El provider es un mock que
// captura los mensajes enviados para hacer assertions.

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.208.0/assert/mod.ts";

import { notifyHotLead } from "../../services/notification.ts";
import {
  createMockWhatsAppProvider,
  createFailingWhatsAppProvider,
} from "../helpers/mocks.ts";

// ---------------------------------------------------------------------------
// Enrutamiento del mensaje
// ---------------------------------------------------------------------------

Deno.test("notifyHotLead - envía el mensaje al teléfono de notificación (no al del lead)", async () => {
  const { provider, getSentMessages } = createMockWhatsAppProvider();

  await notifyHotLead(provider, "573001111111", "573002222222", "lead-abc");

  const messages = getSentMessages();
  assertEquals(messages.length, 1);
  assertEquals(messages[0].to, "573001111111");
});

Deno.test("notifyHotLead - solo envía un único mensaje por llamada", async () => {
  const { provider, getSentMessages } = createMockWhatsAppProvider();

  await notifyHotLead(provider, "573001111111", "573002222222", "lead-abc");

  assertEquals(getSentMessages().length, 1);
});

// ---------------------------------------------------------------------------
// Contenido del mensaje
// ---------------------------------------------------------------------------

Deno.test("notifyHotLead - incluye el teléfono del lead en el cuerpo del mensaje", async () => {
  const { provider, getSentMessages } = createMockWhatsAppProvider();

  await notifyHotLead(provider, "573001111111", "573002222222", "lead-abc");

  assertStringIncludes(getSentMessages()[0].text, "573002222222");
});

Deno.test("notifyHotLead - incluye el lead ID en el cuerpo del mensaje", async () => {
  const { provider, getSentMessages } = createMockWhatsAppProvider();

  await notifyHotLead(provider, "573001111111", "573002222222", "lead-abc-123");

  assertStringIncludes(getSentMessages()[0].text, "lead-abc-123");
});

Deno.test("notifyHotLead - el mensaje incluye indicador de alta intención de compra", async () => {
  const { provider, getSentMessages } = createMockWhatsAppProvider();

  await notifyHotLead(provider, "573001111111", "573002222222", "lead-abc");

  // El mensaje debe comunicar que el lead está listo para comprar
  assertStringIncludes(getSentMessages()[0].text, "intención de compra");
});

// ---------------------------------------------------------------------------
// Resiliencia — fallos del provider nunca deben propagarse
// ---------------------------------------------------------------------------

Deno.test("notifyHotLead - no lanza excepción cuando el provider falla", async () => {
  const failingProvider = createFailingWhatsAppProvider();

  // Si lanza, el test falla — ese es el assertion implícito
  await notifyHotLead(failingProvider, "573001111111", "573002222222", "lead-abc");
});

Deno.test("notifyHotLead - acepta cualquier implementación de WhatsAppProvider", async () => {
  // Verifica que el contrato de la interfaz se mantiene:
  // cualquier objeto con sendMessage funciona como provider
  let called = false;
  const customProvider = {
    sendMessage: async (_to: string, _text: string): Promise<void> => {
      called = true;
    },
  };

  await notifyHotLead(customProvider, "573001111111", "573002222222", "lead-xyz");

  assertEquals(called, true);
});
