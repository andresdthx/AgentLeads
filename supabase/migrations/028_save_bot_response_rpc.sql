-- Migration 028: RPC save_bot_response
--
-- Atomiza las escrituras que ocurren después de cada respuesta del LLM:
--   1. Insertar mensaje del asistente en messages
--   2. Actualizar clasificación y datos extraídos en leads
--
-- Esto garantiza que las dos escrituras ocurran juntas (ACID) o ninguna,
-- evitando el estado inconsistente donde la respuesta se guarda pero el
-- lead no se actualiza (o viceversa).
--
-- La lógica de pausar el bot (order_confirmed, etc.) sigue siendo responsabilidad
-- del handler, ya que ocurre DESPUÉS de enviar el mensaje por WhatsApp.

CREATE OR REPLACE FUNCTION save_bot_response(
  p_lead_id      uuid,
  p_content      text,
  p_score        integer    DEFAULT NULL,
  p_classification text     DEFAULT NULL,
  p_extracted_data jsonb    DEFAULT NULL,
  p_reasoning    text       DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- 1. Guardar respuesta del asistente
  INSERT INTO messages (lead_id, role, content)
  VALUES (p_lead_id, 'assistant', p_content);

  -- 2. Actualizar clasificación del lead (solo si se proporcionó)
  IF p_classification IS NOT NULL THEN
    UPDATE leads
    SET
      score           = COALESCE(p_score, score),
      classification  = p_classification,
      extracted_data  = CASE
                          WHEN p_extracted_data IS NOT NULL
                          THEN COALESCE(extracted_data, '{}'::jsonb) || p_extracted_data
                          ELSE extracted_data
                        END
    WHERE id = p_lead_id;
  END IF;
END;
$$;

-- Solo el rol de service_role puede ejecutar esta función
REVOKE ALL ON FUNCTION save_bot_response FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_bot_response TO service_role;
