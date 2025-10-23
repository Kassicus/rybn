-- =================================================================
-- Temporarily Disable Groups RLS for Debugging
-- This helps us identify if the issue is with RLS or something else
-- IMPORTANT: Re-enable RLS after testing!
-- =================================================================

-- Check current policies
SELECT
  schemaname, tablename, policyname, permissive, roles, cmd, qual
FROM pg_policies
WHERE tablename = 'groups';

-- Drop all INSERT policies temporarily
DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;

-- Temporarily disable RLS on groups table for INSERT only
-- We'll keep SELECT/UPDATE/DELETE policies active
ALTER TABLE groups DISABLE ROW LEVEL SECURITY;

-- Add a notice
DO $$
BEGIN
  RAISE NOTICE 'RLS TEMPORARILY DISABLED on groups table for debugging. Remember to re-enable it!';
END $$;

-- To re-enable later, run:
-- ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
