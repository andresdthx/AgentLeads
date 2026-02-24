-- Migration 022: client_users — maps auth.users to dashboard roles
--
-- Roles:
--   super_admin  — full access to all data; client_id IS NULL
--   client_agent — scoped to their assigned client; client_id NOT NULL

CREATE TABLE IF NOT EXISTS client_users (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id  UUID        REFERENCES clients(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL CHECK (role IN ('super_admin', 'client_agent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,

  UNIQUE (user_id)
);

COMMENT ON TABLE client_users IS
  'Maps Supabase auth users to their dashboard role.
   super_admin: client_id NULL, sees all data.
   client_agent: client_id NOT NULL, scoped to one client.';

-- Trigger for updated_at (reuses existing function)
CREATE TRIGGER update_client_users_updated_at
  BEFORE UPDATE ON client_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Indexes
CREATE INDEX idx_client_users_user_id   ON client_users(user_id);
CREATE INDEX idx_client_users_client_id ON client_users(client_id);

-- RLS
ALTER TABLE client_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access to client_users"
  ON client_users FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Authenticated users can read their own row only (needed by middleware)
CREATE POLICY "users can read own client_users row"
  ON client_users FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT ON client_users TO authenticated;
GRANT ALL    ON client_users TO service_role;
