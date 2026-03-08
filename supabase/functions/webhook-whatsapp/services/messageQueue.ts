// Message queue service — debounces rapid messages per lead.
//
// Pattern: "last-writer-wins"
//   Each invocation enqueues its message, waits DEBOUNCE_MS, then checks
//   whether a newer message arrived for the same phone.
//   • If yes  → this invocation exits (the newer one will be the leader).
//   • If no   → this invocation is the leader: it claims the full batch,
//               marks all as processed, and returns the combined messages.
//
// This works correctly in a stateless edge-function environment because
// the coordination happens through the shared Supabase database.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("message-queue");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/** Milliseconds to wait before deciding this invocation is the leader.
 *  Set DEBOUNCE_MS env var (in ms) to override without redeploying. Default: 6000 */
const DEFAULT_DEBOUNCE_MS = Number(Deno.env.get("DEBOUNCE_MS") ?? 6000);

/**
 * Enqueues a message, waits for the debounce window, then either:
 *   - Returns the ordered list of messages to process (this invocation is the leader).
 *   - Returns null (a newer invocation will handle the batch).
 *
 * @param debounceMs - Per-client override (ms). Falls back to DEBOUNCE_MS env var if omitted.
 */
export async function enqueueAndDebounce(
  phone: string,
  channelPhone: string,
  message: string,
  debounceMs?: number | null
): Promise<string[] | null> {
  const effectiveDebounceMs = debounceMs ?? DEFAULT_DEBOUNCE_MS;
  // 1. Insert this message into the queue
  const { data: queued, error: insertError } = await supabase
    .from("message_queue")
    .insert({ phone, channel_phone: channelPhone, message })
    .select("id, created_at")
    .single();

  if (insertError || !queued) {
    logger.error("Error encolando mensaje", { phone, error: insertError });
    throw insertError ?? new Error("No se pudo encolar el mensaje");
  }

  const myCreatedAt: string = queued.created_at;
  logger.debug("Mensaje encolado", { phone, id: queued.id, debounceMs: effectiveDebounceMs });

  // 2. Wait for the debounce window
  await new Promise((resolve) => setTimeout(resolve, effectiveDebounceMs));

  // 3. Check whether a newer unprocessed message arrived for this phone
  const { data: newerRows, error: newerError } = await supabase
    .from("message_queue")
    .select("id")
    .eq("phone", phone)
    .eq("processed", false)
    .gt("created_at", myCreatedAt)
    .limit(1);

  if (newerError) {
    logger.error("Error verificando mensajes más nuevos", { phone, error: newerError });
    throw newerError;
  }

  if (newerRows && newerRows.length > 0) {
    // A newer message exists — let that invocation be the leader
    logger.debug("No soy el líder del lote, saliendo", { phone, id: queued.id });
    return null;
  }

  // 4. We are the leader — fetch ALL unprocessed messages for this phone
  const { data: batch, error: batchError } = await supabase
    .from("message_queue")
    .select("id, message, created_at")
    .eq("phone", phone)
    .eq("processed", false)
    .order("created_at", { ascending: true });

  if (batchError) {
    logger.error("Error obteniendo lote de mensajes", { phone, error: batchError });
    throw batchError;
  }

  if (!batch || batch.length === 0) {
    // Race condition: another leader already claimed and processed the batch
    logger.debug("Lote vacío tras reclamar liderazgo (race condition)", { phone });
    return null;
  }

  // 5. Mark all as processed atomically
  const ids = batch.map((row) => row.id as string);
  const { error: updateError } = await supabase
    .from("message_queue")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .in("id", ids);

  if (updateError) {
    logger.error("Error marcando mensajes como procesados", { phone, error: updateError });
    throw updateError;
  }

  const messages: string[] = batch.map((row) => row.message as string);
  logger.info("Lote listo para procesar", { phone, count: messages.length });

  return messages;
}
