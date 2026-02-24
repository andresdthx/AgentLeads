-- Migration 024: RLS policies for clients, agent_prompts, and plans

-- ─── CLIENTS ──────────────────────────────────────────────────────────────────

CREATE POLICY "super_admin full access to clients"
  ON clients FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_users
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM client_users
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "client_agent reads own client"
  ON clients FOR SELECT TO authenticated
  USING (
    id IN (
      SELECT cu.client_id FROM client_users cu
      WHERE cu.user_id = auth.uid() AND cu.role = 'client_agent'
    )
  );

GRANT SELECT, INSERT, UPDATE ON clients TO authenticated;

-- ─── AGENT_PROMPTS ────────────────────────────────────────────────────────────

CREATE POLICY "super_admin full access to agent_prompts"
  ON agent_prompts FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM client_users
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM client_users
      WHERE user_id = auth.uid() AND role = 'super_admin'
    )
  );

CREATE POLICY "client_agent reads own and global prompts"
  ON agent_prompts FOR SELECT TO authenticated
  USING (
    client_id IS NULL   -- global prompts (intent, vision)
    OR client_id IN (
      SELECT cu.client_id FROM client_users cu
      WHERE cu.user_id = auth.uid() AND cu.role = 'client_agent'
    )
  );

GRANT SELECT, INSERT, UPDATE ON agent_prompts TO authenticated;

-- ─── PLANS ────────────────────────────────────────────────────────────────────
-- Read-only for all authenticated users (needed for client form dropdown)

CREATE POLICY "authenticated can read plans"
  ON plans FOR SELECT TO authenticated
  USING (true);

GRANT SELECT ON plans TO authenticated;
