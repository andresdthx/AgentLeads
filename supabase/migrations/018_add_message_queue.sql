-- Message queue for debouncing rapid messages per lead
-- When a user sends multiple messages in quick succession, they get batched
-- and processed together instead of triggering multiple LLM responses.

CREATE TABLE IF NOT EXISTS message_queue (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  phone        text        NOT NULL,
  channel_phone text       NOT NULL,
  message      text        NOT NULL,
  created_at   timestamptz DEFAULT now(),
  processed    boolean     DEFAULT false,
  processed_at timestamptz
);

-- Partial index for fast lookup of unprocessed messages per phone
CREATE INDEX IF NOT EXISTS idx_message_queue_phone_unprocessed
  ON message_queue(phone, created_at DESC)
  WHERE processed = false;
