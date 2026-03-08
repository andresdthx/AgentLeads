// Tests del handler de mensajes
//
// ⚠️  Por qué no hay tests de handleIncomingMessage aquí:
//
//   handleIncomingMessage orquesta múltiples servicios (lead, conversation,
//   classifier, intent, inventory, messageQueue, vision, audio) que todos
//   instancian su propio cliente de Supabase internamente. Sin Repository
//   Pattern (inyección de dependencias), no es posible mockear Supabase
//   en tests unitarios sin interceptar el fetch global.
//
//   Para tests de integración del handler, ver el plan del Paso 5 en
//   el análisis del hexagonal-backend-guardian:
//   "Repository Pattern + casos de uso explícitos".
//
// Lo que SÍ está cubierto en esta suite de tests:
//   - services/llm.test.ts     → resolveApiKey
//   - services/intent.test.ts  → hasProductKeywords
//   - services/notification.test.ts → notifyHotLead (con provider inyectado)
//
// TODO (cuando se implemente Repository Pattern):
//   - Test: lead bot_paused → retorna { ok: true, skipped: true, reason: "bot_paused" }
//   - Test: media type no soportado → retorna { ok: true, skipped: true }
//   - Test: cliente no encontrado por channelPhone → retorna { ok: false }
//   - Test: flujo completo con mocks de todos los repositorios
