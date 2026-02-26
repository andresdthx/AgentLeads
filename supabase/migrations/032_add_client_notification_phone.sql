-- Migration 032: Add notification_phone to clients table
--
-- When a lead reaches classification = 'hot', the system sends a WhatsApp
-- message to this number so the sales agent is notified even if the dashboard
-- is not open in the browser.
--
-- Format: international format without + (e.g. "573001234567")
-- NULL = notifications disabled for this client.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS notification_phone TEXT DEFAULT NULL;
