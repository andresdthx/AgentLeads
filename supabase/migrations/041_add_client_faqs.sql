-- Migration 041: Create client_faqs table
-- Stores FAQ entries per client, injected into the LLM system prompt at runtime.
-- Cached alongside ClientConfig (5 min TTL) — zero extra latency per request.

CREATE TABLE IF NOT EXISTS client_faqs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   UUID        NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question    TEXT        NOT NULL,
  answer      TEXT        NOT NULL,
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  sort_order  INTEGER     NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Efficient lookup: active FAQs for a client, ordered
CREATE INDEX idx_client_faqs_client_active
  ON client_faqs(client_id, sort_order)
  WHERE is_active = true;

-- RLS
ALTER TABLE client_faqs ENABLE ROW LEVEL SECURITY;

-- Edge Function (service_role) has full access
CREATE POLICY "service_role_all" ON client_faqs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

-- Dashboard users can read/manage FAQs only for their own clients
CREATE POLICY "authenticated_select_own_client" ON client_faqs
  FOR SELECT TO authenticated
  USING (
    client_id IN (
      SELECT client_id FROM client_users WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "authenticated_manage_own_client" ON client_faqs
  FOR ALL TO authenticated
  USING (
    client_id IN (
      SELECT client_id FROM client_users WHERE user_id = auth.uid()
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT client_id FROM client_users WHERE user_id = auth.uid()
    )
  );

-- Verification
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name = 'client_faqs';
