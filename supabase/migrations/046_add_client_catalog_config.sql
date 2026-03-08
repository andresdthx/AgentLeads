-- Migration 046: Per-client catalog column mapping + static context
-- Allows each client to define how their Google Sheet columns map to
-- display fields, without bloating the clients table.
-- Pattern follows client_faqs (migration 041) — separate table, UNIQUE per client.

CREATE TABLE client_catalog_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Maps logical fields to actual column names in the client's sheet.
  -- Supports: name, price, price_sede, price_domicilio, available, description, notes.
  -- When a key is absent, buildServicesContextBlock falls back to multi-alias defaults.
  col_mapping     JSONB NOT NULL DEFAULT '{
    "name":           "servicio",
    "price_sede":     "precio_sede",
    "price_domicilio":"precio_domicilio",
    "available":      "disponible",
    "description":    "descripcion",
    "notes":          "notas"
  }'::jsonb,

  -- Extra columns to display with custom labels.
  -- Each element: { "column": "duracion", "label": "Duración" }
  extra_fields    JSONB NOT NULL DEFAULT '[]'::jsonb,

  -- Optional static text prepended to the services block (e.g. policies, hours header).
  static_context  TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(client_id)
);
