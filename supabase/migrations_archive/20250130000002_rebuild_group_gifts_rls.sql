-- Completely rebuild RLS policies for group_gifts and group_gift_members
-- This fixes naming issues from the rename and ensures creators can access their gifts

-- =================================================================
-- Drop ALL existing policies
-- =================================================================

-- Drop group_gifts policies
DROP POLICY IF EXISTS "Users can view gift groups they're members of" ON group_gifts;
DROP POLICY IF EXISTS "Users can view group gifts they're members of or created" ON group_gifts;
DROP POLICY IF EXISTS "Users can create gift groups in their groups" ON group_gifts;
DROP POLICY IF EXISTS "Users can update gift groups they created" ON group_gifts;
DROP POLICY IF EXISTS "Users can delete gift groups they created" ON group_gifts;

-- Drop group_gift_members policies
DROP POLICY IF EXISTS "Users can view gift group members" ON group_gift_members;
DROP POLICY IF EXISTS "Gift group creators can add members" ON group_gift_members;
DROP POLICY IF EXISTS "Users can update their own membership" ON group_gift_members;
DROP POLICY IF EXISTS "Users can leave gift groups" ON group_gift_members;
DROP POLICY IF EXISTS "Gift group creators can remove members" ON group_gift_members;

-- =================================================================
-- Recreate policies with proper logic
-- =================================================================

-- Allow creators and members to view group gifts
CREATE POLICY "group_gifts_select"
  ON group_gifts FOR SELECT
  USING (
    -- Creator can always see their gifts
    created_by = auth.uid()
    OR
    -- Members can see gifts they're part of
    EXISTS (
      SELECT 1 FROM group_gift_members
      WHERE group_gift_members.group_gift_id = group_gifts.id
      AND group_gift_members.user_id = auth.uid()
    )
  );

-- Allow group members to create group gifts
CREATE POLICY "group_gifts_insert"
  ON group_gifts FOR INSERT
  WITH CHECK (
    created_by = auth.uid() AND
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = group_gifts.group_id
      AND group_members.user_id = auth.uid()
    )
  );

-- Allow creators to update their group gifts
CREATE POLICY "group_gifts_update"
  ON group_gifts FOR UPDATE
  USING (created_by = auth.uid());

-- Allow creators to delete their group gifts
CREATE POLICY "group_gifts_delete"
  ON group_gifts FOR DELETE
  USING (created_by = auth.uid());

-- =================================================================
-- group_gift_members policies
-- =================================================================

-- Allow viewing members if you're the creator or a member yourself
CREATE POLICY "group_gift_members_select"
  ON group_gift_members FOR SELECT
  USING (
    -- You can see yourself
    user_id = auth.uid()
    OR
    -- Creator can see all members
    EXISTS (
      SELECT 1 FROM group_gifts
      WHERE group_gifts.id = group_gift_members.group_gift_id
      AND group_gifts.created_by = auth.uid()
    )
    OR
    -- Other members can see each other
    EXISTS (
      SELECT 1 FROM group_gift_members AS ggm
      WHERE ggm.group_gift_id = group_gift_members.group_gift_id
      AND ggm.user_id = auth.uid()
    )
  );

-- Only creators can add members
CREATE POLICY "group_gift_members_insert"
  ON group_gift_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM group_gifts
      WHERE group_gifts.id = group_gift_members.group_gift_id
      AND group_gifts.created_by = auth.uid()
    )
  );

-- Users can update their own membership
CREATE POLICY "group_gift_members_update"
  ON group_gift_members FOR UPDATE
  USING (user_id = auth.uid());

-- Users can delete their own membership OR creators can remove anyone
CREATE POLICY "group_gift_members_delete"
  ON group_gift_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR
    EXISTS (
      SELECT 1 FROM group_gifts
      WHERE group_gifts.id = group_gift_members.group_gift_id
      AND group_gifts.created_by = auth.uid()
    )
  );
