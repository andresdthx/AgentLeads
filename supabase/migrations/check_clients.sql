-- Check all clients in database
SELECT
  id,
  name,
  business_type,
  LEFT(system_prompt, 100) as prompt_preview,
  active,
  created_at
FROM clients
ORDER BY created_at;
