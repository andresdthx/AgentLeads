-- Migration 047: Add handoff_mode and handoff_reason to leads
--
-- handoff_mode: semantic grouping of why the bot is paused, drives notification and dashboard UX.
--   technical  → automatic system pause, low urgency (no catalog, out of stock)
--   observer   → human watching (set from dashboard, not from webhook backend)
--   requested  → explicit handoff, human should attend but not critical
--   urgent     → immediate human action required (order confirmed, reservation, LLM urgent)
--
-- handoff_reason: free-text reason emitted by the LLM in a HANDOFF_INICIO...HANDOFF_FIN block.
--   NULL when the pause was triggered by code logic (not by LLM command).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS handoff_mode TEXT
    CHECK (handoff_mode IN ('technical', 'observer', 'requested', 'urgent'));

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT DEFAULT NULL;

-- Backfill existing paused leads based on bot_paused_reason
UPDATE leads
SET handoff_mode = CASE
  WHEN bot_paused_reason IN ('no_catalog', 'out_of_stock', 'config_error')          THEN 'technical'
  WHEN bot_paused_reason IN ('needs_images', 'human_takeover', 'domicilio_exception',
                              'vision_low_conf', 'no_catalog_match', 'llm_handoff') THEN 'requested'
  WHEN bot_paused_reason IN ('order_confirmed', 'reservation_confirmed',
                              'llm_handoff_urgent')                                  THEN 'urgent'
  ELSE NULL
END
WHERE bot_paused = true AND handoff_mode IS NULL;
