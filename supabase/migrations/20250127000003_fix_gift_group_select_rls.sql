-- =================================================================
-- Fix Gift Group SELECT RLS Policy
-- Allow users to view gift groups they created (not just member of)
-- =================================================================

-- Drop the existing SELECT policy
DROP POLICY IF EXISTS "Users can view gift groups they're members of" ON gift_groups;

-- Recreate with both conditions: creator OR member
CREATE POLICY "Users can view gift groups they're members of"
  ON gift_groups FOR SELECT
  USING (
    -- Can view if you created it
    auth.uid() = created_by
    OR
    -- Can view if you're a member
    is_gift_group_member(id, auth.uid())
  );
