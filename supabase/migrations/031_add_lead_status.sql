-- Migration 031: Add status field to leads table
--
-- The frontend uses leads.status extensively for filtering and display, but this
-- column only existed in the web/supabase/migrations/ repo. The backend never
-- created or wrote to it, causing all leads to appear with the default status
-- and breaking the human_active / resolved filters on the dashboard.
--
-- Status lifecycle:
--   bot_active   → bot is handling the conversation (default)
--   human_active → bot is paused, a human agent is in control
--   resolved     → order confirmed, conversation closed successfully
--   lost         → lead disqualified or abandoned

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'bot_active'
    CHECK (status IN ('bot_active', 'human_active', 'resolved', 'lost'));

-- Backfill existing rows based on current bot_paused and order_data values
UPDATE leads
SET status = CASE
  WHEN order_data IS NOT NULL AND order_data->>'pedido_confirmado' = 'true' THEN 'resolved'
  WHEN bot_paused = true THEN 'human_active'
  ELSE 'bot_active'
END;
