-- Migration 029: Add 'classifier' to agent_prompts.agent_type check constraint
--
-- The classifier agent is a separate LLM call (temp=0, no sales persona) that
-- runs after each message is sent. Its prompt lives in agent_prompts with
-- agent_type='classifier' and client_id IS NULL (global, not per-client).

ALTER TABLE agent_prompts
  DROP CONSTRAINT agent_prompts_agent_type_check;

ALTER TABLE agent_prompts
  ADD CONSTRAINT agent_prompts_agent_type_check
  CHECK (agent_type IN ('sales', 'intent', 'vision', 'classifier'));

COMMENT ON COLUMN agent_prompts.agent_type IS
  '"sales" = agente conversacional del cliente | "intent" = extractor de intención (global) | "classifier" = clasificador de lead (global, client_id NULL)';
