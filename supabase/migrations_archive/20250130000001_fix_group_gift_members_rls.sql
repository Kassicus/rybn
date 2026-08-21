-- Fix RLS on group_gift_members to allow creators to see members
-- This prevents circular dependency issues

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view gift group members" ON group_gift_members;

-- Create new policy that allows creators OR members to view
CREATE POLICY "Users can view group gift members"
  ON group_gift_members FOR SELECT
  USING (
    -- Allow if user is the member themselves
    auth.uid() = user_id
    OR
    -- Allow if user is the creator of the group gift
    EXISTS (
      SELECT 1 FROM group_gifts
      WHERE group_gifts.id = group_gift_members.group_gift_id
      AND group_gifts.created_by = auth.uid()
    )
    OR
    -- Allow if user is another member of the same group gift
    EXISTS (
      SELECT 1 FROM group_gift_members AS ggm
      WHERE ggm.group_gift_id = group_gift_members.group_gift_id
      AND ggm.user_id = auth.uid()
    )
  );
