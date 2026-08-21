-- Fix circular RLS dependency for group_gifts
-- Allow creators to see their group gifts immediately after creation

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view gift groups they're members of" ON group_gifts;

-- Create new policy that allows both members AND creators to view
CREATE POLICY "Users can view group gifts they're members of or created"
  ON group_gifts FOR SELECT
  USING (
    -- Allow if user is the creator
    auth.uid() = created_by
    OR
    -- Allow if user is a member
    EXISTS (
      SELECT 1 FROM group_gift_members
      WHERE group_gift_members.group_gift_id = group_gifts.id
      AND group_gift_members.user_id = auth.uid()
    )
  );
