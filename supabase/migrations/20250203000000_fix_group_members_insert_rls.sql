-- =================================================================
-- Fix Group Members INSERT RLS Policy
-- Current policy allows ANY authenticated user to join ANY group
-- New policy restricts to only users joining themselves
-- =================================================================

-- Drop the overly permissive policy
DROP POLICY IF EXISTS "System can insert group members" ON group_members;

-- Create a more restrictive policy
-- Users can only add themselves as members (not others)
-- The group creation trigger uses SECURITY DEFINER so it bypasses RLS
-- Admins/owners adding others should use a service role or SECURITY DEFINER function
CREATE POLICY "Users can add themselves as members"
  ON group_members FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
  );

-- Note: This policy ensures users can only add themselves to groups.
-- The actual authorization (valid invite code, accepted invitation, etc.)
-- is handled in the application layer before the insert.
-- The group creation trigger (SECURITY DEFINER) bypasses RLS to add the creator as owner.
