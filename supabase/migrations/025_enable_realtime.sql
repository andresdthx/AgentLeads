-- Migration 025: Enable Supabase Realtime for dashboard notifications
--
-- Adds leads and messages to the supabase_realtime publication so the
-- Next.js dashboard can subscribe to live changes.
-- Realtime respects RLS when the client authenticates with the anon key.

ALTER PUBLICATION supabase_realtime ADD TABLE leads;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
