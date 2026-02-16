// Test helpers and mocks

import type { Lead, Message, Classification } from "../../types/index.ts";

// Mock Supabase client
export function createMockSupabaseClient() {
  const mockData: Record<string, any> = {
    leads: [],
    messages: [],
  };

  return {
    from: (table: string) => ({
      select: (columns?: string) => ({
        eq: (column: string, value: any) => ({
          single: async () => {
            const item = mockData[table].find((item: any) => item[column] === value);
            return { data: item || null, error: null };
          },
        }),
        order: (column: string, options: any) => ({
          limit: (limit: number) => ({
            then: async (resolve: any) => {
              const data = mockData[table].slice(0, limit);
              resolve({ data, error: null });
            },
          }),
        }),
      }),
      insert: (data: any) => ({
        select: () => ({
          single: async () => {
            const newItem = { ...data, id: crypto.randomUUID() };
            mockData[table].push(newItem);
            return { data: newItem, error: null };
          },
        }),
        then: async (resolve: any) => {
          mockData[table].push(data);
          resolve({ data, error: null });
        },
      }),
      update: (data: any) => ({
        eq: (column: string, value: any) => ({
          then: async (resolve: any) => {
            const index = mockData[table].findIndex((item: any) => item[column] === value);
            if (index !== -1) {
              mockData[table][index] = { ...mockData[table][index], ...data };
            }
            resolve({ data, error: null });
          },
        }),
      }),
    }),
    // Helper to seed data
    _seed: (table: string, data: any[]) => {
      mockData[table] = data;
    },
    // Helper to get data
    _getData: (table: string) => mockData[table],
    // Helper to reset
    _reset: () => {
      Object.keys(mockData).forEach((key) => {
        mockData[key] = [];
      });
    },
  };
}

// Mock fetch for API calls
export function createMockFetch(responses: Record<string, any> = {}) {
  return async (url: string | URL, options?: any): Promise<Response> => {
    const urlString = url.toString();

    // Check if we have a mock response for this URL
    for (const [pattern, response] of Object.entries(responses)) {
      if (urlString.includes(pattern)) {
        return new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Default error response
    return new Response(JSON.stringify({ error: "Not mocked" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  };
}

// Test data factories
export const createTestLead = (overrides: Partial<Lead> = {}): Lead => ({
  id: crypto.randomUUID(),
  phone: "+1234567890",
  name: "Test Lead",
  classification: "warm",
  score: 50,
  current_phase: "new",
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
    authority: "yes",
  },
  reasoning: "Strong indicators of high intent",
  ...overrides,
});

// Environment variable mocks
export function setupTestEnv() {
  const originalEnv = { ...Deno.env.toObject() };

  Deno.env.set("SUPABASE_URL", "https://test.supabase.co");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "test-key");
  Deno.env.set("TWOCHAT_API_KEY", "test-twochat-key");
  Deno.env.set("TWOCHAT_FROM_NUMBER", "+1234567890");
  Deno.env.set("LLM_API_KEY", "test-llm-key");
  Deno.env.set("LLM_OPEN_IA_CHAT_URL", "https://api.openai.com");
  Deno.env.set("LLM_OPEN_IA_CHAT_URL_PATH", "/v1/chat/completions");
  Deno.env.set("WPP_ORQUESTER_PROVIDER_URL", "https://api.2chat.io");
  Deno.env.set("WPP_ORQUESTER_PROVIDER_PATH", "/open/whatsapp/send-message");

  return () => {
    // Restore original env
    Object.keys(originalEnv).forEach((key) => {
      Deno.env.set(key, originalEnv[key]);
    });
  };
}

// Assert helpers
export function assertLead(actual: any, expected: Partial<Lead>) {
  if (expected.phone !== undefined && actual.phone !== expected.phone) {
    throw new Error(`Expected phone ${expected.phone}, got ${actual.phone}`);
  }
  if (expected.name !== undefined && actual.name !== expected.name) {
    throw new Error(`Expected name ${expected.name}, got ${actual.name}`);
  }
  if (expected.classification !== undefined && actual.classification !== expected.classification) {
    throw new Error(`Expected classification ${expected.classification}, got ${actual.classification}`);
  }
}
