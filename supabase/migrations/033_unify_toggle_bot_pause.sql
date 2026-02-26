-- Migration 033: Unified toggle_bot_pause RPC
--
-- Previous state (3 incompatible versions):
--   026: SECURITY INVOKER, returns JSONB, no status update, no handoff note.
--   027: SECURITY INVOKER, returns JSONB, no status update, inserts handoff note on resume.
--   web/001: SECURITY DEFINER, returns JSON, updates status, no handoff note.
--
-- This version is canonical and supersedes all three:
--   - SECURITY INVOKER  → RLS applies correctly, client_agent scoped to own leads.
--   - Returns JSONB      → consistent with the rest of the API.
--   - Updates status     → bot_active on resume, human_active on pause.
--   - Inserts handoff note on resume → single source of truth (removes need to call
--                          saveHandoffNote() from the TypeScript resumeLead() function).

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
    'status',            v_lead.status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_bot_pause(UUID, BOOLEAN, TEXT) TO authenticated;
