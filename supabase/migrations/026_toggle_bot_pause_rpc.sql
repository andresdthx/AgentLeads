-- Migration 026: RPC function to pause or resume a lead's bot
--
-- Uses SECURITY INVOKER so RLS on leads applies:
--   - client_agent can only update leads belonging to their client
--   - super_admin can update any lead
--
-- Called from the Next.js API route: PATCH /api/leads/[id]/bot-pause

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
    updated_at        = NOW()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  RETURN jsonb_build_object(
    'id',                v_lead.id,
    'bot_paused',        v_lead.bot_paused,
    'bot_paused_reason', v_lead.bot_paused_reason,
    'bot_paused_at',     v_lead.bot_paused_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION toggle_bot_pause(UUID, BOOLEAN, TEXT) TO authenticated;
