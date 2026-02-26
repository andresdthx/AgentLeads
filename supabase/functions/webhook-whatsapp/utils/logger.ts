// Logger utility — centralized structured logging for Edge Functions
//
// Usage:
//   import { createLogger } from "../utils/logger.ts";
//   const logger = createLogger("my-service");
//   logger.info("Lead created", { leadId, phone });
//   logger.error("DB error", error);

import { sanitizeLogData } from "./security.ts";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LogEntry {
  ts: string;
  level: LogLevel;
  service: string;
  msg: string;
  data?: unknown;
}

class Logger {
  constructor(private readonly service: string) {}

  private emit(level: LogLevel, msg: string, data?: unknown): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      service: this.service,
      msg,
      ...(data !== undefined && { data: sanitizeLogData(data) }),
    };

    // Single-line JSON → Supabase log viewer lo parsea y filtra por campo
    const line = JSON.stringify(entry);

    switch (level) {
      case "ERROR":
        console.error(line);
        break;
      case "WARN":
        console.warn(line);
        break;
      default:
        console.log(line);
    }
  }

  /** Detalles internos útiles solo en desarrollo (flujo normal, payloads) */
  debug(msg: string, data?: unknown): void {
    this.emit("DEBUG", msg, data);
  }

  /** Eventos de negocio importantes (lead creado, mensaje enviado, clasificación) */
  info(msg: string, data?: unknown): void {
    this.emit("INFO", msg, data);
  }

  /** Situaciones inesperadas pero no fatales */
  warn(msg: string, data?: unknown): void {
    this.emit("WARN", msg, data);
  }

  /** Errores que interrumpen el flujo normal */
  error(msg: string, data?: unknown): void {
    this.emit("ERROR", msg, data);
  }
}

/**
 * Crea un logger con contexto de servicio.
 * @param service  Nombre del módulo: "llm", "lead", "whatsapp", etc.
 */
export function createLogger(service: string): Logger {
  return new Logger(service);
}
