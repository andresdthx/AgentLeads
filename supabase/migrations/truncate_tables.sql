-- Script to delete all records from tables
-- WARNING: This will delete ALL data from leads and messages tables

-- Truncate messages first (due to foreign key)
TRUNCATE TABLE messages CASCADE;

-- Truncate leads
TRUNCATE TABLE leads CASCADE;

-- Verify tables are empty
SELECT 'messages' as table_name, COUNT(*) as row_count FROM messages
UNION ALL
SELECT 'leads' as table_name, COUNT(*) as row_count FROM leads;
