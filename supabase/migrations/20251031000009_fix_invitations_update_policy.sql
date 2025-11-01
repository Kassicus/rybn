-- Fix the invitations UPDATE policy to remove auth.users query
-- The problematic policy was trying to query auth.users which causes permission denied

-- STEP 1: Drop the problematic policy that queries auth.users
DROP POLICY IF EXISTS "Invited users can accept invitations" ON invitations;

-- STEP 2: Drop and recreate the sender update policy to ensure it's working
DROP POLICY IF EXISTS "Invitation senders can update their invitations" ON invitations;

CREATE POLICY "Invitation senders can update their invitations"
  ON invitations FOR UPDATE
  USING (invited_by = auth.uid())
  WITH CHECK (invited_by = auth.uid());

-- STEP 3: Add policy for accepting invitations using user_profiles table instead
-- This avoids querying auth.users directly
CREATE POLICY "Users can accept their invitations"
  ON invitations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.email = invitations.email
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE user_profiles.id = auth.uid()
      AND user_profiles.email = invitations.email
    )
  );

-- Verify policies
SELECT
  policyname,
  cmd as command,
  '✅ Active policy' as status
FROM pg_policies
WHERE tablename = 'invitations'
  AND cmd = 'UPDATE'
ORDER BY policyname;
