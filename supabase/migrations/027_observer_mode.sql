-- Migration 027: Observer mode for paused leads
--
-- 1. Adds resumed_at to leads — tracks when human handed control back to the bot.
-- 2. Updates toggle_bot_pause RPC:
--    - On resume (p_bot_paused = false): sets resumed_at = NOW() and inserts a
--      synthetic assistant note into messages so the LLM has full context when
--      it resumes the conversation.
--    - On pause: clears resumed_at (new pause resets the clock).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ;

-- Update RPC to handle observer mode handoff note
CREATE OR REPLACE FUNCTION toggle_bot_pause(
  p_lead_id    UUID,
  p_bot_paused BOOLEAN,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_lead leads%ROWTYPE;
BEGIN
  UPDATE leads
  SET
    bot_paused        = p_bot_paused,
    bot_paused_at     = CASE WHEN p_bot_paused THEN NOW() ELSE bot_paused_at END,
    bot_paused_reason = CASE WHEN p_bot_paused THEN p_reason ELSE NULL END,
    resumed_at        = CASE WHEN NOT p_bot_paused THEN NOW() ELSE NULL END,
    updated_at        = NOW()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  -- When resuming, insert a synthetic handoff note into conversation history
  -- so the LLM knows the context when it takes over again.
  IF NOT p_bot_paused THEN
    INSERT INTO messages (lead_id, role, content)
    VALUES (
      p_lead_id,
      'assistant',
      '[NOTA INTERNA: El bot estuvo pausado mientras un asesor humano atendía esta conversación. Continúa de forma natural desde donde quedó el cliente.]'
    );
  END IF;

  RETURN jsonb_build_object(
    'id',                v_lead.id,
    'bot_paused',        v_lead.bot_paused,
    'bot_paused_reason', v_lead.bot_paused_reason,
    'bot_paused_at',     v_lead.bot_paused_at,
    'resumed_at',        v_lead.resumed_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_bot_pause(UUID, BOOLEAN, TEXT) TO authenticated;
