// Inventory Service — consulta client_products según la intención detectada
// y construye el bloque de contexto que se inyecta al prompt del LLM.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import type { ClientProduct, ProductIntent, CatalogProduct } from "../types/index.ts";
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
 * Los filtros se aplican solo cuando el campo tiene valor — compatible con cualquier
 * tipo de negocio (productos físicos, servicios, insumos, etc.).
 */
export async function queryInventory(
  clientId: string,
  intent: ProductIntent
): Promise<ClientProduct[]> {
  // Registrar qué filtros se van a aplicar antes de ejecutar la query
  const appliedFilters: Record<string, unknown> = {};

  let query = supabase
    .from("client_products")
    .select("*")
    .eq("client_id", clientId)
    .eq("is_active", true);

  // OR across all detected brands (e.g. ["Nike", "Adidas"] → brand ilike %Nike% OR brand ilike %Adidas%)
  if (intent.brands.length > 0) {
    const brandFilters = intent.brands.map((b) => `brand.ilike.%${b}%`).join(",");
    query = query.or(brandFilters);
    appliedFilters.brands = intent.brands;
  }

  if (intent.model) {
    query = query.ilike("model", `%${intent.model}%`);
    appliedFilters.model = intent.model;
  }

  // Specific product reference (high-precision match, used when brand/model hierarchy is absent)
  if (intent.reference) {
    query = query.ilike("name", `%${intent.reference}%`);
    appliedFilters.reference = intent.reference;
  }

  // Category filter
  if (intent.category) {
    query = query.ilike("category", `%${intent.category}%`);
    appliedFilters.category = intent.category;
  }

  // Sizes: only applied when the intent has sizes AND the client uses size-based products.
  // Skipping when empty avoids filtering out non-sized items (services, supplies, etc.)
  if (intent.sizes.length > 0) {
    query = query.overlaps("available_sizes", intent.sizes);
    appliedFilters.sizes = intent.sizes;
  }

  logger.debug("Ejecutando query de inventario", {
    clientId,
    intent_type: intent.intent_type,
    confidence: intent.confidence,
    filters: Object.keys(appliedFilters).length > 0 ? appliedFilters : "ninguno (búsqueda amplia)",
  });

  query = query
    .order("stock_status", { ascending: true })
    .limit(MAX_PRODUCTS_IN_CONTEXT);

  const { data, error } = await query;

  if (error) {
    logger.error("Error consultando inventario", { clientId, filters: appliedFilters, error });
    return [];
  }

  const count = data?.length ?? 0;

  if (count === 0) {
    logger.info("Inventario sin resultados para los filtros aplicados", {
      clientId,
      filters: appliedFilters,
      suggestion: Object.keys(appliedFilters).length > 0
        ? "Considerar ampliar la búsqueda o revisar datos del inventario"
        : "El cliente no tiene productos activos",
    });
  } else {
    logger.info("Productos encontrados en inventario", {
      clientId,
      count,
      filters: appliedFilters,
      stock_summary: (data ?? []).reduce((acc: Record<string, number>, p: ClientProduct) => {
        acc[p.stock_status] = (acc[p.stock_status] ?? 0) + 1;
        return acc;
      }, {}),
    });
  }

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

  const hasCatalog = (count ?? 0) > 0;
  logger.debug("Verificación de catálogo", { clientId, hasCatalog, total_active: count ?? 0 });
  return hasCatalog;
}

/**
 * Construye el bloque de contexto de catálogo para inyectar en el system prompt.
 * Usado cuando capabilities.catalog = true y no hay resultados de búsqueda específicos.
 * El LLM decide cuándo compartir el enlace según el historial de conversación.
 * Copy genérico — válido para productos físicos y servicios.
 */
export function buildCatalogSection(catalogUrl: string): string {
  return [
    "--- CATÁLOGO ---",
    `URL del catálogo: ${catalogUrl}`,
    `Cuando debas compartir el catálogo, usa exactamente esta URL: ${catalogUrl}`,
    "Cuando el cliente pregunte por productos, servicios, precios o imágenes, comparte este enlace.",
    "Después de compartirlo, pídele que te indique qué le interesó para confirmar disponibilidad y precio.",
    "Si ya compartiste el catálogo en este chat, no lo vuelvas a enviar — espera la respuesta del cliente.",
    "---",
  ].join("\n");
}

/**
 * Builds a context section from external catalog search results (Shopify, WooCommerce,
 * Google Sheets, etc.). Generic — valid for physical products and services alike.
 * Used in catalog mode when a specific match was found via searchCatalog().
 */
export function buildCatalogSearchSection(
  products: CatalogProduct[],
  showCatalogUrl: string | null | undefined
): string {
  const lines: string[] = ["--- RESULTADOS DEL CATÁLOGO ---"];

  products.forEach((p, i) => {
    lines.push(`${i + 1}. ${p.name}`);
    if (p.price)       lines.push(`   Precio: ${p.price}`);
    lines.push(`   Estado: ${p.available ? "disponible" : "sin existencias"}`);
    if (p.url)         lines.push(`   Link: ${p.url}`);
    if (p.description) lines.push(`   Info: ${p.description}`);
  });

  if (showCatalogUrl) {
    lines.push(`\nCatálogo completo: ${showCatalogUrl}`);
  }

  lines.push("---");
  return lines.join("\n");
}

/**
 * Formatea los productos en un bloque de texto estructurado para inyectar
 * en el system prompt del LLM.
 * Adaptativo: solo muestra los campos que tienen datos — válido para productos
 * físicos (marca/modelo/tallas), servicios (categoría/descripción) e insumos.
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

    // Build the metadata line with only non-null fields
    const meta: string[] = [];
    if (p.brand)    meta.push(`Marca: ${p.brand}`);
    if (p.model)    meta.push(`Modelo: ${p.model}`);
    if (p.category) meta.push(`Categoría: ${p.category}`);
    meta.push(`Estado: ${statusLabel[p.stock_status] ?? p.stock_status}`);
    lines.push(`   ${meta.join(" | ")}`);

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
