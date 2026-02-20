-- ============================================
-- SCRIPT: DELETE ALL RECORDS FROM TABLES
-- ============================================
-- WARNING: This will permanently delete ALL data
-- Execute this in Supabase SQL Editor
-- https://supabase.com/dashboard/project/pgwklddzkizicqigvipf/sql
-- ============================================

-- Step 1: Delete all messages (due to foreign key dependency)
DELETE FROM messages;

-- Step 2: Delete all leads
DELETE FROM leads;

-- Step 3: Verify tables are empty
SELECT
  'messages' as table_name,
  COUNT(*) as remaining_rows
FROM messages
UNION ALL
SELECT
  'leads' as table_name,
  COUNT(*) as remaining_rows
FROM leads;

-- Expected result: both tables should show 0 rows
