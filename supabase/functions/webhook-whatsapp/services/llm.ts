// LLM service - handles AI conversation and classification

import type { LLMMessage, Classification, Message } from "../types/index.ts";
import { SYSTEM_PROMPT, LLM_CONFIG } from "../config/prompts.ts";

const LLM_API_KEY = Deno.env.get("LLM_API_KEY")!;
const LLM_OPEN_IA_CHAT_URL = Deno.env.get("LLM_OPEN_IA_CHAT_URL")!;
const LLM_OPEN_IA_CHAT_URL_PATH = Deno.env.get("LLM_OPEN_IA_CHAT_URL_PATH")!;

/**
 * Build messages array for LLM
 */
function buildLLMMessages(history: Message[]): LLMMessage[] {
  const messages: LLMMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];

  // Add conversation history
  history.forEach((msg) => {
    messages.push({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    });
  });

  return messages;
}

/**
 * Call OpenAI LLM
 */
async function callLLM(messages: LLMMessage[]): Promise<string> {
  const response = await fetch(`${LLM_OPEN_IA_CHAT_URL}${LLM_OPEN_IA_CHAT_URL_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_CONFIG.model,
      messages,
      temperature: LLM_CONFIG.temperature,
    }),
  });

  const data = await response.json();

  if (!data.choices?.[0]?.message?.content) {
    console.error("LLM error:", JSON.stringify(data));
    throw new Error("No response from LLM");
  }

  return data.choices[0].message.content;
}

/**
 * Parse classification from LLM response
 */
function parseClassification(response: string): Classification | null {
  const classMatch = response.match(/CLASIFICACION([\s\S]*)FIN/);

  if (!classMatch) {
    return null;
  }

  try {
    const classification = JSON.parse(classMatch[1].trim());
    return classification;
  } catch (e) {
    console.error("Error parseando clasificación:", e);
    return null;
  }
}

/**
 * Clean response by removing classification block
 */
function cleanResponse(response: string): string {
  return response.replace(/CLASIFICACION[\s\S]*FIN/, "").trim();
}

/**
 * Generate LLM response and extract classification if present
 */
export async function generateResponse(
  history: Message[]
): Promise<{ response: string; classification: Classification | null }> {
  const messages = buildLLMMessages(history);
  const llmResponse = await callLLM(messages);

  const classification = parseClassification(llmResponse);
  const cleanedResponse = cleanResponse(llmResponse);

  return {
    response: cleanedResponse,
    classification,
  };
}
