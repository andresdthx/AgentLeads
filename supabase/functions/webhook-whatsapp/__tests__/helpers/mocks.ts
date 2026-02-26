// Test helpers and mocks

import type { Lead, Message, Classification, WhatsAppProvider } from "../../types/index.ts";

// ---------------------------------------------------------------------------
// Mock WhatsApp provider — captura los mensajes enviados para assertions
// ---------------------------------------------------------------------------

export function createMockWhatsAppProvider() {
  const sentMessages: Array<{ to: string; text: string }> = [];

  const provider: WhatsAppProvider = {
    sendMessage: async (to: string, text: string): Promise<void> => {
      sentMessages.push({ to, text });
    },
  };

  return {
    provider,
    getSentMessages: () => sentMessages,
    reset: () => sentMessages.splice(0),
  };
}

export function createFailingWhatsAppProvider(): WhatsAppProvider {
  return {
    sendMessage: async (_to: string, _text: string): Promise<void> => {
      throw new Error("Provider error simulado");
    },
  };
}

// ---------------------------------------------------------------------------
// Mock Supabase client — usado por lead.test.ts y conversation.test.ts
// Nota: prueba el comportamiento del mock, no los servicios de producción.
// Los servicios reales (lead.ts, conversation.ts) instancian su propio
// cliente de Supabase internamente y no son inyectables aún.
// ---------------------------------------------------------------------------

export function createMockSupabaseClient() {
  const mockData: Record<string, any[]> = {
    leads: [],
    messages: [],
  };

  return {
    from: (table: string) => ({
      select: (_columns?: string) => ({
        eq: (column: string, value: any) => ({
          single: async () => {
            const item = mockData[table]?.find((item: any) => item[column] === value);
            return { data: item ?? null, error: null };
          },
        }),
        order: (_column: string, _options: any) => ({
          limit: (limit: number) =>
            Promise.resolve({ data: (mockData[table] ?? []).slice(0, limit), error: null }),
        }),
      }),
      insert: (data: any) => {
        const newItem = { ...data, id: data.id ?? crypto.randomUUID() };
        if (!mockData[table]) mockData[table] = [];
        mockData[table].push(newItem);
        const result = { data: newItem, error: null };
        return Object.assign(Promise.resolve(result), {
          select: () => ({
            single: () => Promise.resolve(result),
          }),
        });
      },
      update: (data: any) => ({
        eq: (column: string, value: any) => {
          const index = (mockData[table] ?? []).findIndex((item: any) => item[column] === value);
          if (index !== -1) {
            mockData[table][index] = { ...mockData[table][index], ...data };
          }
          return Promise.resolve({ data, error: null });
        },
      }),
    }),
    _seed: (table: string, data: any[]) => {
      mockData[table] = data;
    },
    _getData: (table: string) => mockData[table] ?? [],
    _reset: () => {
      Object.keys(mockData).forEach((key) => {
        mockData[key] = [];
      });
    },
  };
}

// Mock fetch genérico para APIs externas
export function createMockFetch(responses: Record<string, any> = {}) {
  return async (url: string | URL, _options?: RequestInit): Promise<Response> => {
    const urlString = url.toString();

    for (const [pattern, response] of Object.entries(responses)) {
      if (urlString.includes(pattern)) {
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ error: "Not mocked" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// ---------------------------------------------------------------------------
// Factories de datos de prueba
// ---------------------------------------------------------------------------

export const createTestLead = (overrides: Partial<Lead> = {}): Lead => ({
  id: crypto.randomUUID(),
  phone: "+1234567890",
  client_id: crypto.randomUUID(),
  classification: null,
  score: null,
  bot_paused: false,
  ...overrides,
});

export const createTestMessage = (overrides: Partial<Message> = {}): Message => ({
  lead_id: crypto.randomUUID(),
  role: "user",
  content: "Test message",
  ...overrides,
});

export const createTestClassification = (
  overrides: Partial<Classification> = {}
): Classification => ({
  score: 75,
  classification: "hot",
  extracted: {
    need: "website",
    timeline: "2 weeks",
    budget: "$5000",
  },
  reasoning: "Strong indicators of high intent",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Setup de variables de entorno para tests
// ---------------------------------------------------------------------------

export function setupTestEnv(): () => void {
  const originalEnv = { ...Deno.env.toObject() };

  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
  Deno.env.set("TWOCHAT_API_KEY", "test-twochat-key");
  Deno.env.set("LLM_API_KEY", "test-llm-key");
  Deno.env.set("LLM_API_KEY_OPENAI", "test-openai-key");

  return () => {
    // Eliminar vars añadidas por el test
    for (const key of Object.keys(Deno.env.toObject())) {
      if (!(key in originalEnv)) {
        Deno.env.delete(key);
      }
    }
    // Restaurar las originales
    for (const [key, value] of Object.entries(originalEnv)) {
      Deno.env.set(key, value);
    }
  };
}

// Assert helper para Lead
export function assertLead(actual: any, expected: Partial<Lead>) {
  if (expected.phone !== undefined && actual.phone !== expected.phone) {
    throw new Error(`Expected phone ${expected.phone}, got ${actual.phone}`);
  }
  if (expected.client_id !== undefined && actual.client_id !== expected.client_id) {
    throw new Error(`Expected client_id ${expected.client_id}, got ${actual.client_id}`);
  }
}
