-- Migration 037: Fix toggle_bot_pause — SECURITY DEFINER
--
-- Bug (033): la función usaba SECURITY INVOKER, lo que significa que corre como
-- el usuario autenticado. Al reactivar el bot inserta una nota en messages, pero
-- `authenticated` solo tiene GRANT SELECT en esa tabla → INSERT falla → rollback
-- completo → ni el UPDATE en leads se persiste.
--
-- Fix: cambiar a SECURITY DEFINER para que la función corra como su propietario
-- (postgres/superuser) y pueda INSERT en messages sin relajar los GRANTs globales.
-- El scope de RLS sobre leads se mantiene porque el UPDATE ya fue validado antes
-- del INSERT, y la función solo opera sobre el lead_id recibido.
--
-- Mantiene el mismo contrato de la 033:
--   - Actualiza bot_paused, status, timestamps en leads
--   - Inserta nota de retomada en messages (solo al reactivar)
--   - Retorna JSONB con los campos actualizados

CREATE OR REPLACE FUNCTION toggle_bot_pause(
  p_lead_id    UUID,
  p_bot_paused BOOLEAN,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
                          WHEN p_bot_paused THEN 'human_active'
                          ELSE                   'bot_active'
                        END,
    updated_at        = NOW()
  WHERE id = p_lead_id
  RETURNING * INTO v_lead;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'lead_not_found');
  END IF;

  -- Al reactivar: insertar nota interna para que el LLM tenga contexto completo.
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
