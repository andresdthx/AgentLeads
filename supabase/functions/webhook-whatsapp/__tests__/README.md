# Tests para webhook-whatsapp

Este directorio contiene las pruebas unitarias para la edge function webhook-whatsapp.

## Estructura de Tests

```
__tests__/
├── helpers/
│   └── mocks.ts          # Mocks y helpers para testing
├── services/
│   ├── lead.test.ts      # Tests del servicio de leads
│   ├── conversation.test.ts  # Tests del servicio de conversación
│   └── llm.test.ts       # Tests del servicio LLM
└── handlers/
    └── message.test.ts   # Tests del handler de mensajes
```

## Ejecutar Tests

### Todos los tests
```bash
cd supabase/functions/webhook-whatsapp
deno task test
```

### Tests en modo watch (auto-reload)
```bash
deno task test:watch
```

### Tests con cobertura
```bash
deno task test:coverage
deno task coverage
```

### Tests específicos
```bash
# Un archivo específico
deno test __tests__/services/llm.test.ts --allow-env --allow-net

# Tests que coincidan con un patrón
deno test --filter "LLM Service" --allow-env --allow-net
```

## Cobertura de Tests

Los tests cubren:

### ✅ Servicio LLM (`llm.test.ts`)
- Parsing de clasificación desde respuestas LLM
- Limpieza de respuestas (remover bloques de clasificación)
- Manejo de JSON malformado
- Construcción de mensajes para el LLM
- Validación de scores y categorías

### ✅ Servicio de Leads (`lead.test.ts`)
- Buscar leads por teléfono
- Crear nuevos leads
- Actualizar clasificación de leads
- Get or create lead (idempotencia)
- Manejo de datos extraídos
- Múltiples leads

### ✅ Servicio de Conversación (`conversation.test.ts`)
- Guardar mensajes de usuario
- Guardar mensajes del asistente
- Obtener historial de conversación
- Respetar límites de historial
- Separación de conversaciones por lead
- Preservación de formato en mensajes

### ✅ Handler de Mensajes (`message.test.ts`)
- Validación de payloads
- Skip de mensajes no válidos
- Extracción de datos del payload
- Flujo de procesamiento
- Manejo de formatos de teléfono
- Mensajes largos y caracteres especiales

## Helpers y Mocks

### `createMockSupabaseClient()`
Mock del cliente de Supabase con soporte para:
- Operaciones CRUD básicas
- Seed de datos de test
- Reset de estado

### `createMockFetch()`
Mock de fetch para simular llamadas API

### `createTest*()` factories
Funciones helper para crear datos de test:
- `createTestLead()` - Genera leads de prueba
- `createTestMessage()` - Genera mensajes de prueba
- `createTestClassification()` - Genera clasificaciones de prueba

### `setupTestEnv()`
Configura variables de entorno para tests

## Agregar Nuevos Tests

1. Crea un nuevo archivo `*.test.ts` en el directorio apropiado
2. Importa las utilidades de testing:
   ```typescript
   import { assertEquals, assertExists } from "https://deno.land/std@0.208.0/assert/mod.ts";
   import { createMockSupabaseClient } from "../helpers/mocks.ts";
   ```
3. Escribe tus tests usando `Deno.test()`
4. Ejecuta los tests para verificar

## Buenas Prácticas

- ✅ Cada test debe ser independiente
- ✅ Usa mocks para dependencias externas (Supabase, APIs)
- ✅ Nombres descriptivos de tests
- ✅ Un concepto por test
- ✅ Usa factories para crear datos de test
- ✅ Limpia el estado entre tests cuando sea necesario

## CI/CD

Para integrar en CI/CD, agrega:

```yaml
- name: Run tests
  run: |
    cd supabase/functions/webhook-whatsapp
    deno task test:coverage
```
