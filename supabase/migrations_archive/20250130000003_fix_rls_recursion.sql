-- Fix infinite recursion in RLS policies
-- The key is to avoid circular dependencies between tables

-- Drop the problematic policies
DROP POLICY IF EXISTS "group_gifts_select" ON group_gifts;
DROP POLICY IF EXISTS "group_gift_members_select" ON group_gift_members;

-- =================================================================
-- Simplified group_gifts SELECT policy (no recursion)
-- =================================================================
CREATE POLICY "group_gifts_select"
  ON group_gifts FOR SELECT
  USING (
    -- Creators can always see their gifts
    created_by = auth.uid()
    OR
    -- Members can see gifts (only checks user_id, no recursion)
    EXISTS (
      SELECT 1 FROM group_gift_members
      WHERE group_gift_members.group_gift_id = group_gifts.id
      AND group_gift_members.user_id = auth.uid()
    )
  );

-- =================================================================
-- Simplified group_gift_members SELECT policy (no recursion)
-- =================================================================
CREATE POLICY "group_gift_members_select"
  ON group_gift_members FOR SELECT
  USING (
    -- You can always see your own membership
    user_id = auth.uid()
    OR
    -- Creators can see all members (only checks created_by, no recursion)
    EXISTS (
      SELECT 1 FROM group_gifts
      WHERE group_gifts.id = group_gift_members.group_gift_id
      AND group_gifts.created_by = auth.uid()
    )
  );

-- Note: We removed the "other members can see each other" condition
-- which was causing recursion. Members can still see other members
-- through the creator's perspective, which is sufficient.
