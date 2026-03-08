-- Migration 048: Add notify_on_handoff_requested to clients
--
-- When true, the sales agent receives a WhatsApp notification for handoffs
-- classified as 'requested' (needs_images, vision_low_conf, no_catalog_match, llm_handoff).
-- Urgent handoffs (order, reservation, llm_handoff_urgent) always notify regardless of this flag.
-- Technical handoffs (no_catalog, out_of_stock) never notify.
--
-- Default false: existing clients keep current behaviour (no new notifications).

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS notify_on_handoff_requested BOOLEAN NOT NULL DEFAULT false;
