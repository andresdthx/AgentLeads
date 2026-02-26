// security.ts — Controles de seguridad para el webhook de WhatsApp
//
// Módulos incluidos:
//   1. Rate limiter   — ventana deslizante en memoria, por clave (phone / IP)
//   2. Payload guard  — rechazo por Content-Length excesivo
//   3. Input validator — teléfono E.164, longitud de texto, MIME type
//   4. SSRF guard     — bloqueo de IPs privadas en URLs de media
//   5. fetchWithTimeout — envuelve fetch con AbortController
//   6. sanitizeLogData  — redacta API keys y PII antes de loguear

// ---------------------------------------------------------------------------
// 1. Rate Limiter (en memoria, por instancia Deno)
// ---------------------------------------------------------------------------

interface RateBucket {
  count: number;
  resetAt: number; // timestamp ms cuando el bucket se reinicia
}

// Valores por defecto — sobreescribibles via env vars
const DEFAULT_RATE_LIMIT_PHONE_MAX = parseInt(
  Deno.env.get("RATE_LIMIT_PHONE_MAX") ?? "30",
  10
);
const DEFAULT_RATE_LIMIT_PHONE_WINDOW_MS = parseInt(
  Deno.env.get("RATE_LIMIT_PHONE_WINDOW_MS") ?? "60000", // 1 minuto
  10
);
const DEFAULT_RATE_LIMIT_GLOBAL_MAX = parseInt(
  Deno.env.get("RATE_LIMIT_GLOBAL_MAX") ?? "200",
  10
);
const DEFAULT_RATE_LIMIT_GLOBAL_WINDOW_MS = parseInt(
  Deno.env.get("RATE_LIMIT_GLOBAL_WINDOW_MS") ?? "60000",
  10
);

const rateLimitStore = new Map<string, RateBucket>();

/**
 * Limpia entradas expiradas para evitar que el Map crezca sin límite.
 * Se llama con probabilidad del 2% por request (compromiso costo/beneficio).
 */
function pruneExpiredBuckets(): void {
  const now = Date.now();
  for (const [key, bucket] of rateLimitStore) {
    if (now >= bucket.resetAt) rateLimitStore.delete(key);
  }
}

/**
 * Verifica si la clave `key` puede hacer una request más dentro de la ventana.
 * Retorna `true` si se permite, `false` si se debe rechazar (429).
 */
export function checkRateLimit(
  key: string,
  maxRequests: number = DEFAULT_RATE_LIMIT_PHONE_MAX,
  windowMs: number = DEFAULT_RATE_LIMIT_PHONE_WINDOW_MS
): boolean {
  if (Math.random() < 0.02) pruneExpiredBuckets();

  const now = Date.now();
  const bucket = rateLimitStore.get(key);

  if (!bucket || now >= bucket.resetAt) {
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (bucket.count >= maxRequests) return false;

  bucket.count++;
  return true;
}

/**
 * Rate limit global (por canal / instancia). Protege contra flood masivo
 * antes de parsear el body.
 */
export function checkGlobalRateLimit(channelKey: string): boolean {
  return checkRateLimit(
    `global:${channelKey}`,
    DEFAULT_RATE_LIMIT_GLOBAL_MAX,
    DEFAULT_RATE_LIMIT_GLOBAL_WINDOW_MS
  );
}

// ---------------------------------------------------------------------------
// 2. Payload size guard
// ---------------------------------------------------------------------------

// 512 KB es suficiente para cualquier payload legítimo de WhatsApp
const MAX_PAYLOAD_BYTES = parseInt(
  Deno.env.get("MAX_PAYLOAD_BYTES") ?? String(512 * 1024),
  10
);

// Límite de descarga de archivos de media (audio / imagen)
export const MAX_MEDIA_BYTES = parseInt(
  Deno.env.get("MAX_MEDIA_BYTES") ?? String(20 * 1024 * 1024), // 20 MB
  10
);

/**
 * Retorna true si el Content-Length declara un payload demasiado grande.
 * No lee el body — solo inspecciona headers (O(1)).
 */
export function isPayloadTooLarge(req: Request): boolean {
  const cl = req.headers.get("content-length");
  if (!cl) return false; // Sin Content-Length → no rechazar aquí
  const bytes = parseInt(cl, 10);
  return !isNaN(bytes) && bytes > MAX_PAYLOAD_BYTES;
}

// ---------------------------------------------------------------------------
// 3. Input validation
// ---------------------------------------------------------------------------

// Formato E.164 + variantes de WhatsApp (sin '+' obligatorio, 7-15 dígitos)
const PHONE_RE = /^\+?[1-9]\d{6,14}$/;

// Máximo de texto por mensaje (evita payloads de 1 MB en campos de texto)
export const MAX_TEXT_LENGTH = parseInt(
  Deno.env.get("MAX_TEXT_LENGTH") ?? "4096",
  10
);

/**
 * Valida que el número de teléfono sea razonablemente E.164.
 * No bloquea variantes locales de WhatsApp que pueden llegar sin "+".
 */
export function isValidPhone(phone: string): boolean {
  if (!phone || typeof phone !== "string") return false;
  return PHONE_RE.test(phone.trim());
}

/**
 * Verifica que el texto del mensaje no supere el límite configurado.
 * `undefined` siempre pasa (campo opcional).
 */
export function isTextWithinLimit(text: string | undefined): boolean {
  return !text || text.length <= MAX_TEXT_LENGTH;
}

/**
 * Valida que el MIME type tenga formato estándar (type/subtype).
 * Previene inyecciones a través del campo mime_type del payload.
 */
export function isValidMimeType(mime: string): boolean {
  if (!mime || typeof mime !== "string" || mime.length > 128) return false;
  const base = mime.split(";")[0].trim();
  return /^[\w\-]+\/[\w\-+.]+$/.test(base);
}

// ---------------------------------------------------------------------------
// 4. SSRF guard
// ---------------------------------------------------------------------------

// Rangos RFC1918 + loopback + link-local + IPv6 privadas
const PRIVATE_IP_RE =
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|127\.|0\.|169\.254\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:)/i;
const BLOCKED_HOSTS = new Set([
  "localhost",
  "0.0.0.0",
  "metadata.google.internal", // GCP IMDS
  "169.254.169.254",           // AWS / Azure IMDS
]);

/**
 * Retorna true si la URL es segura para hacer fetch externo.
 * Bloquea:
 *  - HTTP (solo HTTPS permitido)
 *  - IPs privadas RFC1918 y loopback
 *  - Endpoints de metadata cloud (IMDS)
 */
export function isSafeMediaUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);

    // Solo HTTPS
    if (url.protocol !== "https:") return false;

    const host = url.hostname.toLowerCase();

    // Hosts explícitamente bloqueados
    if (BLOCKED_HOSTS.has(host)) return false;

    // IPs privadas / loopback
    if (PRIVATE_IP_RE.test(host)) return false;

    return true;
  } catch {
    // URL malformada
    return false;
  }
}

// ---------------------------------------------------------------------------
// 5. fetchWithTimeout
// ---------------------------------------------------------------------------

/**
 * Fetch con timeout automático vía AbortController.
 * Si la respuesta no llega en `timeoutMs` ms, lanza AbortError.
 *
 * @param url        URL a fetchear
 * @param options    RequestInit estándar (sin signal — se gestiona aquí)
 * @param timeoutMs  Timeout en ms (default: 10 s)
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs = 10_000
): Promise<Response> {
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timerId);
  }
}

// ---------------------------------------------------------------------------
// 6. Log sanitizer
// ---------------------------------------------------------------------------

// Patrones de API keys conocidos: OpenAI (sk-...), genéricos
const API_KEY_PATTERNS = [
  /sk-[a-zA-Z0-9\-_]{20,}/g,             // OpenAI
  /Bearer\s+[a-zA-Z0-9\-_\.]{20,}/g,     // Bearer tokens
  /[a-zA-Z0-9]{32,}(?=["\s,}])/g,        // Strings largos genéricos (conservador)
];

// Nombres de campo que siempre se redactan
const SENSITIVE_FIELD_NAMES = new Set([
  "api_key",
  "apikey",
  "api-key",
  "authorization",
  "token",
  "secret",
  "password",
  "passwd",
  "x-user-api-key",
  "service_role_key",
]);

/**
 * Redacta valores sensibles de un objeto antes de enviarlo al logger.
 * - Claves con nombres sensibles → "[REDACTED]"
 * - Strings con patrones de API key → "[REDACTED]"
 * - Campo "messages" (arrays de conversación) → "[N messages]" (PII)
 * - Campo "content" largo → truncado a 200 chars
 */
export function sanitizeLogData(data: unknown, depth = 0): unknown {
  // Evitar recursión infinita en estructuras circulares
  if (depth > 8) return "[deep object]";
  if (data === null || data === undefined) return data;

  if (typeof data === "string") {
    let sanitized = data;
    for (const pattern of API_KEY_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
    return sanitized;
  }

  if (Array.isArray(data)) {
    // Si parece un array de mensajes de LLM, no loguear contenido
    if (
      depth > 0 &&
      data.length > 0 &&
      typeof data[0] === "object" &&
      data[0] !== null &&
      ("role" in (data[0] as object) || "content" in (data[0] as object))
    ) {
      return `[${data.length} LLM messages — omitidos]`;
    }
    return data.map((item) => sanitizeLogData(item, depth + 1));
  }

  if (typeof data === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      const keyLower = k.toLowerCase().replace(/[^a-z0-9]/g, "_");

      if (SENSITIVE_FIELD_NAMES.has(keyLower)) {
        result[k] = "[REDACTED]";
        continue;
      }

      // Campo "content" largo: truncar para evitar volcar conversaciones enteras
      if (keyLower === "content" && typeof v === "string" && v.length > 300) {
        result[k] = v.substring(0, 300) + "… [truncado]";
        continue;
      }

      result[k] = sanitizeLogData(v, depth + 1);
    }
    return result;
  }

  return data;
}
