-- Migration 030: Enable REPLICA IDENTITY FULL on leads table
--
-- Supabase Realtime by default only sends the new row values on UPDATE events.
-- Without REPLICA IDENTITY FULL, payload.old is empty, so comparisons like
--   old.classification !== "hot"
--   !old.bot_paused
-- always evaluate as `undefined !== "hot"` → true, firing duplicate notifications
-- on every UPDATE regardless of what actually changed.
--
-- REPLICA IDENTITY FULL makes Postgres include the full old row in the WAL record,
-- which Supabase Realtime forwards as payload.old to the client listener.

ALTER TABLE leads REPLICA IDENTITY FULL;
