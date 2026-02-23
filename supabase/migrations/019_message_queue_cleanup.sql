-- Automatic cleanup of message_queue rows older than 24 hours.
--
-- Strategy: pg_cron scheduled job running every hour.
-- Only processed rows are deleted; unprocessed rows are left intact
-- (they are still within an active debounce window or indicate a bug
-- worth investigating rather than silently discarding).

-- Enable pg_cron extension (requires superuser; available on Supabase Pro/Team)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Index to make the periodic DELETE fast (avoids a full table scan)
CREATE INDEX IF NOT EXISTS idx_message_queue_created_at
  ON message_queue(created_at)
  WHERE processed = true;

-- Schedule cleanup: every hour delete processed rows older than 24 hours.
-- cron.schedule returns the job id, so wrap in DO block to suppress output.
DO $$
BEGIN
  -- Remove any previous version of this job to keep the schedule idempotent
  PERFORM cron.unschedule('message_queue_cleanup')
  WHERE EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'message_queue_cleanup'
  );

  PERFORM cron.schedule(
    'message_queue_cleanup',          -- job name (unique)
    '0 * * * *',                      -- every hour at minute 0
    $$
      DELETE FROM message_queue
      WHERE processed = true
        AND created_at < now() - INTERVAL '24 hours';
    $$
  );
END;
$$;
