-- Migration 023: RLS policies for leads and messages — authenticated dashboard users
--
-- super_admin: full access to all rows
-- client_agent: scoped to rows belonging to their assigned client

-- ─── LEADS ────────────────────────────────────────────────────────────────────

CREATE POLICY "super_admin full access to leads"
  ON leads FOR ALL TO authenticated
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

CREATE POLICY "client_agent reads own client leads"
  ON leads FOR SELECT TO authenticated
  USING (
    client_id IN (
      SELECT cu.client_id FROM client_users cu
      WHERE cu.user_id = auth.uid() AND cu.role = 'client_agent'
    )
  );

-- client_agent can UPDATE bot_paused / bot_paused_reason (via toggle_bot_pause RPC)
CREATE POLICY "client_agent can update own client leads"
  ON leads FOR UPDATE TO authenticated
  USING (
    client_id IN (
      SELECT cu.client_id FROM client_users cu
      WHERE cu.user_id = auth.uid() AND cu.role = 'client_agent'
    )
  )
  WITH CHECK (
    client_id IN (
      SELECT cu.client_id FROM client_users cu
      WHERE cu.user_id = auth.uid() AND cu.role = 'client_agent'
    )
  );

GRANT SELECT, UPDATE ON leads TO authenticated;

-- ─── MESSAGES ─────────────────────────────────────────────────────────────────

CREATE POLICY "super_admin full access to messages"
  ON messages FOR ALL TO authenticated
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

CREATE POLICY "client_agent reads messages for own leads"
  ON messages FOR SELECT TO authenticated
  USING (
    lead_id IN (
      SELECT l.id FROM leads l
      JOIN client_users cu ON cu.client_id = l.client_id
      WHERE cu.user_id = auth.uid() AND cu.role = 'client_agent'
    )
  );

GRANT SELECT ON messages TO authenticated;
