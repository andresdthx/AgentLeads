// Inventory Service — consulta client_products según la intención detectada
// y construye el bloque de contexto que se inyecta al prompt del LLM.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ClientProduct, ProductIntent } from "../types/index.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("inventory");

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

/** Máximo de productos a inyectar en contexto para no inflar el prompt */
const MAX_PRODUCTS_IN_CONTEXT = 8;

/**
 * Consulta los productos del cliente filtrando por la intención extraída.
 * Siempre ordena: available → low_stock → out_of_stock.
 */
export async function queryInventory(
  clientId: string,
  intent: ProductIntent
): Promise<ClientProduct[]> {
  let query = supabase
    .from("client_products")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true);

  if (intent.brand) {
    query = query.ilike("brand", `%${intent.brand}%`);
  }

  if (intent.model) {
    query = query.ilike("model", `%${intent.model}%`);
  }

  if (intent.sizes.length > 0) {
    query = query.overlaps("available_sizes", intent.sizes);
  }

  query = query
    .order("stock_status", { ascending: true })
    .limit(MAX_PRODUCTS_IN_CONTEXT);

  const { data, error } = await query;

  if (error) {
    logger.error("Error consultando inventario", { clientId, intent, error });
    return [];
  }

  logger.debug("Productos encontrados", {
    clientId,
    count: data?.length ?? 0,
    brand: intent.brand,
    model: intent.model,
  });

  return (data ?? []) as ClientProduct[];
}

/**
 * Verifica si el cliente tiene ALGÚN producto activo en su catálogo.
 */
export async function clientHasCatalog(clientId: string): Promise<boolean> {
  const { count, error } = await supabase
    .from("client_products")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("is_active", true);

  if (error) {
    logger.warn("Error verificando catálogo del cliente", { clientId, error });
    return false;
  }

  return (count ?? 0) > 0;
}

/**
 * Construye el bloque de contexto de catálogo para inyectar en el system prompt.
 * Usado cuando product_mode = 'catalog'.
 * El LLM decide cuándo compartir el enlace según el historial de conversación.
 */
export function buildCatalogSection(catalogUrl: string): string {
  return [
    "--- CATÁLOGO DE PRODUCTOS ---",
    `Enlace del catálogo: ${catalogUrl}`,
    "Cuando el cliente pregunte por productos, precios o imágenes, comparte este enlace.",
    "Después de compartirlo, pídele la referencia específica que le interesó para confirmar disponibilidad y precio.",
    "Si ya compartiste el catálogo en este chat, no lo vuelvas a enviar — espera la referencia.",
    "---",
  ].join("\n");
}

/**
 * Formatea los productos en un bloque de texto estructurado para inyectar
 * en el system prompt del LLM.
 */
export function buildInventorySection(products: ClientProduct[]): string {
  if (products.length === 0) return "";

  const statusLabel: Record<string, string> = {
    available: "disponible",
    low_stock: "pocas unidades",
    out_of_stock: "agotado",
  };

  const lines: string[] = ["--- INVENTARIO DISPONIBLE ---"];

  products.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.name}`);
    lines.push(
      `   Marca: ${p.brand ?? "—"} | Modelo: ${p.model ?? "—"} | Estado: ${statusLabel[p.stock_status] ?? p.stock_status}`
    );

    if (p.available_sizes.length > 0) {
      lines.push(`   Tallas: ${p.available_sizes.join(", ")}`);
    }

    const prices: string[] = [];
    if (p.price_retail != null) {
      prices.push(`Precio detal: $${p.price_retail.toLocaleString("es-CO")}`);
    }
    if (p.price_wholesale != null) {
      prices.push(`Precio mayorista: $${p.price_wholesale.toLocaleString("es-CO")}`);
    }
    if (prices.length > 0) lines.push(`   ${prices.join(" | ")}`);

    if (p.description) {
      lines.push(`   Info: ${p.description}`);
    }
  });

  lines.push("---");
  return lines.join("\n");
}
