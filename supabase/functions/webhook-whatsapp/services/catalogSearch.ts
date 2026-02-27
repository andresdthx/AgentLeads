// Catalog Search Service — searches products on external e-commerce sites.
//
// Supports:
//   - Shopify   → /search/suggest.json (public JSON endpoint, no auth)
//   - WooCommerce → /?s={query}&post_type=product (public HTML search page)
//   - Generic HTML → tries both adapters as fallback
//
// Results are cached in memory per (consultUrl + query) with a 30-min TTL,
// avoiding redundant fetches within the same function instance.

import type { CatalogProduct, VisionResult } from "../types/index.ts";
import { isSafeMediaUrl, fetchWithTimeout } from "../utils/security.ts";
import { createLogger } from "../utils/logger.ts";

const logger = createLogger("catalog-search");

// ---------------------------------------------------------------------------
// In-memory cache
// ---------------------------------------------------------------------------

const CACHE = new Map<string, { products: CatalogProduct[]; expiresAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

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
function detectCatalogType(url: string): "shopify" | "woocommerce" | "html" {
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
    if (catalogType === "shopify") {
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
