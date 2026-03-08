// Catalog Search Service — searches products on external e-commerce sites.
//
// Supports:
//   - Shopify        → /search/suggest.json (public JSON endpoint, no auth)
//   - WooCommerce    → /?s={query}&post_type=product (public HTML search page)
//   - Google Sheets  → CSV export (public sheet, no auth) or Sheets API v4 (API key optional)
//   - Generic HTML   → tries both adapters as fallback
//
// Results are cached in memory per (consultUrl + query) with a 30-min TTL,
// avoiding redundant fetches within the same function instance.
// Google Sheets additionally caches raw sheet data separately (30 min) to
// avoid re-fetching the full sheet for every distinct query.

import type { CatalogProduct, VisionResult, ClientCatalogConfig } from "../types/index.ts";
import { isSafeMediaUrl, fetchWithTimeout } from "../utils/security.ts";
import { createLogger } from "../utils/logger.ts";
import { config } from "../config.ts";

const logger = createLogger("catalog-search");

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const CACHE = new Map<string, { products: CatalogProduct[]; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

/** Raw Google Sheets row cache — keyed by consultUrl, independent of query. */
const SHEET_DATA_CACHE = new Map<string, { rows: Record<string, string>[]; expiresAt: number }>();
const SHEET_DATA_TTL_MS = 30 * 60 * 1000; // 30 min

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extracts scheme + host from any URL. */
function getBaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url;
  }
}

/** Detects the e-commerce platform from the URL. */
function detectCatalogType(url: string): "shopify" | "woocommerce" | "google_sheets" | "html" {
  if (
    url.includes("docs.google.com/spreadsheets") ||
    url.includes("sheets.googleapis.com/v4/spreadsheets")
  ) return "google_sheets";

  if (url.includes("myshopify.com")) return "shopify";
  // Shopify custom domains often have /products/ or /collections/
  if (/\/products\/|\/collections\//.test(url)) return "shopify";
  // WooCommerce / WordPress indicators
  if (/\/producto\/|\/shop\/|\/categoria-producto\/|\/wp-json\//.test(url)) return "woocommerce";
  return "html";
}

/**
 * Builds a plain-text search query from a VisionResult.
 * Combines the most relevant fields, keeping the query under 100 chars.
 */
export function buildSearchQuery(vision: VisionResult): string {
  if (vision.type === "no_product") return "";

  const parts: string[] = [];

  if (vision.type === "product") {
    if (vision.name)       parts.push(vision.name);
    if (vision.brand)      parts.push(vision.brand);
    if (vision.reference)  parts.push(vision.reference);
    if (vision.attributes) parts.push(vision.attributes);
  } else if (vision.type === "catalog" && vision.products.length > 0) {
    const p = vision.products[0];
    if (p.name)      parts.push(p.name);
    if (p.reference) parts.push(p.reference);
    if (p.attributes) parts.push(p.attributes);
  }

  return parts.join(" ").slice(0, 100).trim();
}

// ---------------------------------------------------------------------------
// Google Sheets adapter — CSV export (public) or Sheets API v4
// ---------------------------------------------------------------------------

/**
 * Parses a single CSV line, handling quoted fields with embedded commas.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === "," && !inQuotes) {
      fields.push(current.trim()); current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Parses a CSV string (with header row) into an array of row objects.
 * Keys are lowercased column headers.
 */
function parseSheetCSV(csvText: string): Record<string, string>[] {
  const lines = csvText.split("\n").filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i] ?? ""]));
  });
}

/**
 * Scores a row against query tokens.
 * Matches in name/service column are weighted 3x over other columns.
 */
function scoreRow(row: Record<string, string>, queryTokens: string[]): number {
  const nameField = (
    row["servicio"] ?? row["producto"] ?? row["nombre"] ??
    row["service"] ?? row["name"] ?? ""
  ).toLowerCase();

  const fullText = Object.values(row).join(" ").toLowerCase();

  return queryTokens.reduce((score, token) => {
    if (fullText.includes(token)) score += 1;
    if (nameField.includes(token)) score += 2;
    return score;
  }, 0);
}

/** Maps a sheet row (any supported column name variant) to a CatalogProduct. */
function rowToCatalogProduct(row: Record<string, string>): CatalogProduct {
  const name = (
    row["servicio"] ?? row["producto"] ?? row["nombre"] ??
    row["service"] ?? row["name"] ?? ""
  ).trim();

  const price = (
    row["precio"] ?? row["price"] ?? row["valor"] ?? row["costo"] ?? null
  )?.trim() || null;

  const description = (
    row["descripcion"] ?? row["descripción"] ?? row["description"] ?? row["detalle"] ?? null
  )?.trim().slice(0, 150) || null;

  const availableRaw = (
    row["disponible"] ?? row["available"] ?? row["activo"] ?? "si"
  ).toLowerCase().trim();
  const available = !["no", "false", "0", "agotado", "no disponible", "inactivo"].includes(availableRaw);

  return { name, price, url: null, available, description };
}

/**
 * Builds the Google Sheets CSV export URL from any Sheets URL variant.
 * Preserves the gid (tab) if present in the original URL.
 */
function buildSheetCsvUrl(consultUrl: string): string | null {
  // Already a CSV export URL — ensure format=csv is set
  if (consultUrl.includes("/export")) {
    const u = new URL(consultUrl);
    u.searchParams.set("format", "csv");
    return u.toString();
  }

  // Extract sheet ID from standard Google Sheets URL pattern
  const idMatch = consultUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (!idMatch) return null;

  const sheetId = idMatch[1];
  const gidMatch = consultUrl.match(/[?&]gid=(\d+)/);
  const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";

  return `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv${gidParam}`;
}

/** Fetches and parses all rows from a Google Sheet. Caches raw data for SHEET_DATA_TTL_MS. */
async function fetchSheetRows(consultUrl: string): Promise<Record<string, string>[]> {
  const cached = SHEET_DATA_CACHE.get(consultUrl);
  if (cached && Date.now() < cached.expiresAt) {
    logger.debug("Google Sheets raw data desde caché", { consultUrl });
    return cached.rows;
  }

  const csvUrl = buildSheetCsvUrl(consultUrl);
  if (!csvUrl) {
    logger.warn("No se pudo construir URL de CSV para Google Sheets", { consultUrl });
    return [];
  }

  if (!isSafeMediaUrl(csvUrl)) {
    logger.warn("URL Google Sheets bloqueada por SSRF guard", { csvUrl });
    return [];
  }

  // API key (optional) — only used when the sheet is not fully public
  const headers: Record<string, string> = {};
  const apiKey = config.GOOGLE_SHEETS_API_KEY;
  if (apiKey) {
    const u = new URL(csvUrl);
    u.searchParams.set("key", apiKey);
    // csvUrl is reassigned below via the res fetch — use the modified URL directly
    const res = await fetchWithTimeout(u.toString(), { headers }, 8_000);
    return await processSheetResponse(res, consultUrl, u.toString());
  }

  const res = await fetchWithTimeout(csvUrl, { headers }, 8_000);
  return await processSheetResponse(res, consultUrl, csvUrl);
}

async function processSheetResponse(
  res: Response,
  consultUrl: string,
  fetchedUrl: string,
): Promise<Record<string, string>[]> {
  if (!res.ok) {
    logger.warn("Google Sheets fetch falló", { status: res.status, url: fetchedUrl });
    return [];
  }

  // Guard against Google returning the HTML login page instead of CSV
  const contentType = res.headers.get("content-type") ?? "";
  if (
    !contentType.includes("text/csv") &&
    !contentType.includes("text/plain") &&
    !contentType.includes("application/octet-stream")
  ) {
    logger.warn("Google Sheets devolvió respuesta no-CSV — Sheet posiblemente privado", {
      contentType,
      url: fetchedUrl,
    });
    return [];
  }

  const csvText = await res.text();
  const rows = parseSheetCSV(csvText);

  logger.info("Google Sheets cargado", { consultUrl, rows: rows.length });
  SHEET_DATA_CACHE.set(consultUrl, { rows, expiresAt: Date.now() + SHEET_DATA_TTL_MS });
  return rows;
}

/** Searches a Google Sheet by text-scoring all rows against query tokens. */
async function searchGoogleSheets(consultUrl: string, query: string): Promise<CatalogProduct[]> {
  const rows = await fetchSheetRows(consultUrl);
  if (rows.length === 0) return [];

  const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);

  if (queryTokens.length === 0) {
    // No meaningful tokens — return up to 5 available entries as a general listing
    return rows.map(rowToCatalogProduct).filter((p) => p.name && p.available).slice(0, 5);
  }

  return rows
    .map((row) => ({ product: rowToCatalogProduct(row), score: scoreRow(row, queryTokens) }))
    .filter(({ product, score }) => score > 0 && product.name)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ product }) => product);
}

// ---------------------------------------------------------------------------
// Shopify adapter — /search/suggest.json
// ---------------------------------------------------------------------------

async function searchShopify(baseUrl: string, query: string): Promise<CatalogProduct[]> {
  const url = `${baseUrl}/search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=5`;

  if (!isSafeMediaUrl(url)) {
    logger.warn("URL Shopify bloqueada por SSRF guard", { url });
    return [];
  }

  const res = await fetchWithTimeout(url, {}, 8_000);
  if (!res.ok) {
    logger.warn("Shopify search falló", { status: res.status, url });
    return [];
  }

  // deno-lint-ignore no-explicit-any
  const data: any = await res.json();
  const items: Record<string, unknown>[] = data?.resources?.results?.products ?? [];

  return items.map((p) => ({
    name:        String(p.title ?? ""),
    price:       p.price ? String(p.price) : null,
    url:         p.url ? `${baseUrl}${p.url}` : null,
    available:   p.available !== false,
    description: p.body ? String(p.body).replace(/<[^>]+>/g, "").slice(0, 150) : null,
  }));
}

// ---------------------------------------------------------------------------
// WooCommerce adapter — /?s=query&post_type=product (HTML parser)
// ---------------------------------------------------------------------------

async function searchWooCommerce(baseUrl: string, query: string): Promise<CatalogProduct[]> {
  const url = `${baseUrl}/?s=${encodeURIComponent(query)}&post_type=product`;

  if (!isSafeMediaUrl(url)) {
    logger.warn("URL WooCommerce bloqueada por SSRF guard", { url });
    return [];
  }

  const res = await fetchWithTimeout(url, {}, 8_000);
  if (!res.ok) {
    logger.warn("WooCommerce search falló", { status: res.status, url });
    return [];
  }

  const html = await res.text();
  return parseWooCommerceResults(html, baseUrl);
}

/**
 * Parses WooCommerce standard search results HTML.
 * Extracts product name, URL, price, and stock status.
 *
 * Targets the standard WooCommerce loop markup:
 *   <li class="product [outofstock]">
 *     <a href="{url}" class="...woocommerce-loop-product__link...">
 *       <h2 class="...woocommerce-loop-product__title...">NAME</h2>
 *       <span class="...woocommerce-Price-amount...">$PRICE</span>
 *     </a>
 *   </li>
 */
function parseWooCommerceResults(html: string, baseUrl: string): CatalogProduct[] {
  const products: CatalogProduct[] = [];

  // Match each <li class="product ..."> block
  const liRegex = /<li[^>]+class="[^"]*\bproduct\b[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let liMatch: RegExpExecArray | null;

  while ((liMatch = liRegex.exec(html)) !== null && products.length < 5) {
    const block = liMatch[0];
    const inner = liMatch[1];

    // Stock status
    const available = !/class="[^"]*\boutofstock\b[^"]*"/.test(block);

    // Product URL + title — look for a link followed (anywhere) by the title heading
    const linkRegex = /href="([^"]+)"[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i;
    const linkMatch = linkRegex.exec(inner);
    if (!linkMatch) continue;

    const rawUrl  = linkMatch[1];
    const rawName = linkMatch[2].replace(/<[^>]+>/g, "").trim();
    if (!rawName) continue;

    const productUrl = rawUrl.startsWith("http") ? rawUrl : `${baseUrl}${rawUrl}`;

    // Price — extract from woocommerce-Price-amount or first <bdi>
    const priceRegex = /<(?:span|bdi)[^>]*class="[^"]*(?:woocommerce-Price-amount|amount)[^"]*"[^>]*>([\s\S]*?)<\/(?:span|bdi)>/i;
    const priceMatch = priceRegex.exec(inner) ?? /<bdi>([\s\S]*?)<\/bdi>/i.exec(inner);
    const price = priceMatch ? priceMatch[1].replace(/<[^>]+>/g, "").trim() : null;

    products.push({ name: rawName, price, url: productUrl, available, description: null });
  }

  return products;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Services catalog — full-load (no query filter)
// ---------------------------------------------------------------------------

/**
 * Loads ALL rows from a Google Sheet without filtering.
 * Intended for small service catalogs (masajes, clases, etc.) that must be
 * injected entirely into the system prompt on every message turn.
 * Returns [] for non-Google-Sheets URLs (use searchCatalog for those).
 */
export async function fetchAllServices(
  consultUrl: string
): Promise<Record<string, string>[]> {
  if (detectCatalogType(consultUrl) !== "google_sheets") {
    logger.warn("fetchAllServices solo soporta Google Sheets", { consultUrl });
    return [];
  }
  return fetchSheetRows(consultUrl);
}

// Default extra fields (used when no client_catalog_config is configured).
// Order defines display order in the context block.
const DEFAULT_EXTRA_FIELDS: [string[], string][] = [
  [["duracion", "duración", "duration", "tiempo"],                            "Duración"],
  [["modalidad", "modalidades", "modality"],                                  "Modalidad"],
  [["horarios_semana", "horarios entre semana", "horarios lunes a viernes"], "Horarios entre semana"],
  [["horarios_finde", "horarios fin de semana", "horarios sabado domingo"],  "Horarios fin de semana"],
  [["recargo", "recargo_domicilio", "recargo domicilio"],                    "Recargo domicilio"],
  [["zona", "zona_cobertura", "cobertura", "zona de cobertura"],             "Zona de cobertura"],
  [["direccion", "dirección", "sede", "direccion_sede"],                     "Dirección sede"],
  [["pago", "formas_pago", "formas de pago", "metodo_pago"],                 "Formas de pago"],
  [["addons", "add_ons", "complementos", "extras"],                          "Add-ons"],
  [["descripcion", "descripción", "description", "detalle"],                 "Descripción"],
  [["notas", "nota", "notes", "note", "observaciones"],                      "Notas"],
];

// Values that mean "not available" for the disponible/available column
const NOT_AVAILABLE = new Set(["no", "false", "0", "agotado", "no disponible", "inactivo"]);

/**
 * Formats all service rows from a Google Sheet into a structured text block
 * suitable for injection into {{SERVICIOS_INYECTADOS}} in the system prompt.
 *
 * When `config` is provided (from client_catalog_config):
 *   - Uses `col_mapping` to look up columns by exact name (no alias fallback).
 *   - Uses `extra_fields` to display additional columns with custom labels.
 *   - Prepends `static_context` (e.g. policies, location) before the rows.
 *
 * When `config` is null (default):
 *   - Falls back to multi-alias detection for Spanish/English column variants.
 *   - Backward compatible with all existing clients.
 *
 * Price handling (both modes):
 *   - Specific price_sede / price_domicilio columns → labeled with sede/domicilio.
 *   - Generic price column → labeled as "Precio" to avoid "Precio sede" mislabeling.
 */
export function buildServicesContextBlock(
  rows: Record<string, string>[],
  config: ClientCatalogConfig | null = null
): string {
  if (rows.length === 0) return "(sin datos de servicios)";

  const lines: string[] = [];
  const colMap = config?.col_mapping ?? {};
  const useConfig = config !== null;

  // Prepend static context (location info, policies, etc.) when configured
  if (config?.static_context?.trim()) {
    lines.push(config.static_context.trim());
    lines.push("");
  }

  for (const row of rows) {
    // --- Name ---
    const name = (
      useConfig && colMap.name
        ? row[colMap.name]
        : (row["servicio"] ?? row["producto"] ?? row["nombre"] ?? row["service"] ?? row["name"])
    )?.trim();

    if (!name) continue;

    // --- Availability ---
    const availableRaw = (
      useConfig && colMap.available
        ? row[colMap.available]
        : (row["disponible"] ?? row["available"] ?? row["activo"])
    )?.toLowerCase().trim() ?? "si";
    const isAvailable = !NOT_AVAILABLE.has(availableRaw);

    lines.push(`**${name}**${isAvailable ? "" : " (no disponible)"}`);

    // --- Prices ---
    if (useConfig) {
      const precioSede = colMap.price_sede ? row[colMap.price_sede]?.trim() : undefined;
      const precioDom  = colMap.price_domicilio ? row[colMap.price_domicilio]?.trim() : undefined;
      const precioGen  = colMap.price ? row[colMap.price]?.trim() : undefined;
      if (precioSede) lines.push(`  Precio sede: ${precioSede}`);
      if (precioDom)  lines.push(`  Precio domicilio: ${precioDom}`);
      if (!precioSede && !precioDom && precioGen) lines.push(`  Precio: ${precioGen}`);
    } else {
      // Multi-alias fallback (original behaviour)
      const precioSede = ["precio_sede", "precio sede", "price_sede"].map((k) => row[k]).find((v) => v?.trim());
      const precioDom  = ["precio_domicilio", "precio domicilio", "price_domicilio"].map((k) => row[k]).find((v) => v?.trim());
      const precioGen  = ["precio", "price", "valor", "costo"].map((k) => row[k]).find((v) => v?.trim());
      if (precioSede) lines.push(`  Precio sede: ${precioSede.trim()}`);
      if (precioDom)  lines.push(`  Precio domicilio: ${precioDom.trim()}`);
      if (!precioSede && !precioDom && precioGen) lines.push(`  Precio: ${precioGen.trim()}`);
    }

    // --- Extra fields ---
    if (useConfig && config!.extra_fields.length > 0) {
      for (const field of config!.extra_fields) {
        const val = row[field.column]?.trim();
        if (val) lines.push(`  ${field.label}: ${val}`);
      }
    } else {
      for (const [keys, label] of DEFAULT_EXTRA_FIELDS) {
        const val = keys.map((k) => row[k]).find((v) => v?.trim());
        if (val?.trim()) lines.push(`  ${label}: ${val.trim()}`);
      }
    }

    lines.push("");
  }

  return lines.join("\n").trim();
}

/**
 * Searches products in an external catalog URL.
 * Auto-detects platform (Shopify / WooCommerce / HTML) and uses the right adapter.
 * Results are cached per (consultUrl + query) for CACHE_TTL_MS.
 *
 * Returns up to 5 matching CatalogProduct entries, or [] on error.
 */
export async function searchCatalog(
  consultUrl: string,
  query: string
): Promise<CatalogProduct[]> {
  // Defensive guard: catch accidental object-as-query bugs at runtime.
  // buildSearchQuery() must always be called before passing a VisionResult here.
  if (typeof query !== "string" || !query.trim()) return [];

  const cacheKey = `${consultUrl}::${query.toLowerCase().trim()}`;
  const cached = CACHE.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    logger.debug("Catalog search desde caché", { consultUrl, query });
    return cached.products;
  }

  const baseUrl     = getBaseUrl(consultUrl);
  const catalogType = detectCatalogType(consultUrl);

  logger.debug("Buscando en catálogo externo", { baseUrl, catalogType, query });

  let products: CatalogProduct[] = [];

  try {
    if (catalogType === "google_sheets") {
      products = await searchGoogleSheets(consultUrl, query);
    } else if (catalogType === "shopify") {
      products = await searchShopify(baseUrl, query);
    } else if (catalogType === "woocommerce") {
      products = await searchWooCommerce(baseUrl, query);
    } else {
      // Generic: try WooCommerce first, then Shopify
      products = await searchWooCommerce(baseUrl, query);
      if (products.length === 0) {
        products = await searchShopify(baseUrl, query);
      }
    }
  } catch (e) {
    logger.error("Error buscando en catálogo externo", { baseUrl, query, error: String(e) });
    return [];
  }

  logger.info("Catalog search completado", { baseUrl, query, results: products.length });

  CACHE.set(cacheKey, { products, expiresAt: Date.now() + CACHE_TTL_MS });
  return products;
}
