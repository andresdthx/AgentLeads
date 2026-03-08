-- Migration 043: Drop deprecated columns from agent_prompts
--
-- Removes columns that were never meaningfully populated at runtime:
--   - description: free-text field unused by any query or TypeScript code
--   - version:     numeric versioning replaced by created_at ordering + is_active flag
--
-- All TypeScript references to these columns have been removed in the same commit.

ALTER TABLE agent_prompts
  DROP COLUMN IF EXISTS description,
  DROP COLUMN IF EXISTS version;
