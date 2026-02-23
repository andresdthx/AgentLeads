-- =============================================================================
-- Migration 017: Datos de pedido confirmado en leads
-- =============================================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS order_data          JSONB,
  ADD COLUMN IF NOT EXISTS order_confirmed_at  TIMESTAMPTZ;

COMMENT ON COLUMN leads.order_data         IS 'JSON del pedido confirmado: { pedido_confirmado, ciudad_envio, tipo_cliente, items[] }';
COMMENT ON COLUMN leads.order_confirmed_at IS 'Timestamp en que el agente confirmó el pedido y pausó el bot';
