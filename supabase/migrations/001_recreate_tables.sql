-- Migration: Recreate leads and messages tables
-- Author: AgentsLeads
-- Date: 2026-02-15

-- ============================================
-- DROP EXISTING TABLES
-- ============================================

-- Drop tables in correct order (messages first due to foreign key)
DROP TABLE IF EXISTS messages CASCADE;
DROP TABLE IF EXISTS leads CASCADE;

-- ============================================
-- CREATE LEADS TABLE
-- ============================================

CREATE TABLE leads (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Contact info
  phone TEXT NOT NULL UNIQUE,
  name TEXT,

  -- Classification data
  classification TEXT CHECK (classification IN ('hot', 'warm', 'cold')),
  score INTEGER CHECK (score >= 0 AND score <= 100),
  extracted_data JSONB,
  current_phase TEXT DEFAULT 'new',

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

-- ============================================
-- CREATE MESSAGES TABLE
-- ============================================

CREATE TABLE messages (
  -- Primary key
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Foreign key to leads
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Message data
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,

  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- CREATE INDEXES
-- ============================================

-- Leads indexes
CREATE INDEX idx_leads_phone ON leads(phone);
CREATE INDEX idx_leads_classification ON leads(classification);
CREATE INDEX idx_leads_score ON leads(score DESC);
CREATE INDEX idx_leads_created_at ON leads(created_at DESC);

-- Messages indexes
CREATE INDEX idx_messages_lead_id ON messages(lead_id);
CREATE INDEX idx_messages_created_at ON messages(created_at DESC);
CREATE INDEX idx_messages_lead_created ON messages(lead_id, created_at DESC);

-- ============================================
-- ADD COMMENTS
-- ============================================

COMMENT ON TABLE leads IS 'Stores lead information and classification data';
COMMENT ON COLUMN leads.phone IS 'WhatsApp phone number (unique identifier)';
COMMENT ON COLUMN leads.classification IS 'Lead temperature: hot (70-100), warm (40-69), cold (0-39)';
COMMENT ON COLUMN leads.score IS 'Lead score from 0 to 100';
COMMENT ON COLUMN leads.extracted_data IS 'Extracted data: {need, timeline, budget, authority}';
COMMENT ON COLUMN leads.current_phase IS 'Current lead phase: new, classified, contacted, etc.';

COMMENT ON TABLE messages IS 'Stores conversation history between user and assistant';
COMMENT ON COLUMN messages.role IS 'Message sender: user or assistant';
COMMENT ON COLUMN messages.content IS 'Message text content';

-- ============================================
-- ENABLE ROW LEVEL SECURITY (RLS)
-- ============================================

ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Create policies for service role (full access)
CREATE POLICY "Service role has full access to leads"
  ON leads
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Service role has full access to messages"
  ON messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================
-- CREATE HELPER FUNCTION FOR updated_at
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for leads.updated_at
CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- GRANT PERMISSIONS
-- ============================================

-- Grant necessary permissions to service_role
GRANT ALL ON leads TO service_role;
GRANT ALL ON messages TO service_role;
