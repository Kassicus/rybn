-- =================================================================
-- Fix Group Creation RLS Policy
-- Ensures authenticated users can create groups with proper created_by
-- =================================================================

-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;

-- Create policy that works for authenticated users (via anon key with JWT)
-- Validates that created_by matches the authenticated user's ID
CREATE POLICY "Authenticated users can create groups"
  ON groups FOR INSERT
  WITH CHECK (
    auth.uid() IS NOT NULL AND
    created_by = auth.uid()
  );

-- Verify the policy was created
DO $$
BEGIN
  RAISE NOTICE 'Group creation policy has been updated. Authenticated users can now create groups where created_by matches their user ID.';
END $$;
