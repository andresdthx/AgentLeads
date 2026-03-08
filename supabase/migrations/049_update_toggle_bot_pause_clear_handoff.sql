-- Migration 049: Update toggle_bot_pause to clear handoff fields on resume
--
-- When the dashboard resumes a lead (p_bot_paused = false), clear handoff_mode
-- and handoff_reason so the lead returns to a clean bot_active state.
-- On pause from dashboard, handoff_mode is set to NULL (dashboard pauses have
-- no automatic urgency; the webhook backend sets handoff_mode via pauseLeadWithHandoff).

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
    bot_paused_at     = CASE WHEN p_bot_paused     THEN NOW() ELSE bot_paused_at END,
    bot_paused_reason = CASE WHEN p_bot_paused     THEN p_reason ELSE NULL END,
    resumed_at        = CASE WHEN NOT p_bot_paused THEN NOW() ELSE NULL END,
    status            = CASE
                          WHEN p_bot_paused     THEN 'human_active'
                          ELSE                       'bot_active'
                        END,
    -- Clear handoff fields on resume; leave NULL on dashboard-initiated pause
    -- (handoff_mode is set by the webhook backend via pauseLeadWithHandoff)
    handoff_mode      = CASE WHEN NOT p_bot_paused THEN NULL ELSE handoff_mode END,
    handoff_reason    = CASE WHEN NOT p_bot_paused THEN NULL ELSE handoff_reason END,
    updated_at        = NOW()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  -- On resume: insert a synthetic handoff note so the LLM has full context.
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
    'resumed_at',        v_lead.resumed_at,
    'status',            v_lead.status,
    'handoff_mode',      v_lead.handoff_mode
  );
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_bot_pause(UUID, BOOLEAN, TEXT) TO authenticated;
