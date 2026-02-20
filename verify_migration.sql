-- Verify migration 008 results
SELECT
  id,
  name,
  business_type,
  LEFT(system_prompt, 150) as prompt_preview,
  active,
  created_at,
  updated_at
FROM clients
ORDER BY created_at;

-- Count leads per client
SELECT
  c.name as client_name,
  COUNT(l.id) as lead_count
FROM clients c
LEFT JOIN leads l ON l.client_id = c.id
GROUP BY c.id, c.name;
