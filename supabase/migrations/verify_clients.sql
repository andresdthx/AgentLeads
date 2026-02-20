-- Verify all clients in the database
SELECT
  id,
  name,
  business_type,
  LEFT(system_prompt, 80) as prompt_start,
  llm_model,
  llm_temperature,
  conversation_history_limit,
  active,
  created_at
FROM clients
ORDER BY created_at DESC;
