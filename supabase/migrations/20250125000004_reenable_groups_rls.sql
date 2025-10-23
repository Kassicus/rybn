-- =================================================================
-- Re-enable Groups RLS with Proper Policies
-- Now that we use service role for creation, we can keep RLS simple
-- =================================================================

-- Ensure RLS is enabled
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;

-- Drop all existing policies to start fresh
DROP POLICY IF EXISTS "Authenticated users can create groups" ON groups;
DROP POLICY IF EXISTS "Users can view groups they're members of" ON groups;
DROP POLICY IF EXISTS "Group owners and admins can update groups" ON groups;
DROP POLICY IF EXISTS "Group owners can delete groups" ON groups;

-- SELECT: Users can view groups they're members of
CREATE POLICY "Users can view groups they're members of"
  ON groups FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
      AND group_members.user_id = auth.uid()
    )
  );

-- UPDATE: Owners and admins can update groups
CREATE POLICY "Group owners and admins can update groups"
  ON groups FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
      AND group_members.user_id = auth.uid()
      AND group_members.role IN ('owner', 'admin')
    )
  );

-- DELETE: Only owners can delete groups
CREATE POLICY "Group owners can delete groups"
  ON groups FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_members.group_id = groups.id
      AND group_members.user_id = auth.uid()
      AND group_members.role = 'owner'
    )
  );

-- NOTE: We don't need an INSERT policy because group creation uses
-- the service role key (admin client) which bypasses RLS.
-- This is safe because the server action validates the user first.

COMMENT ON TABLE groups IS
'Group creation uses service role (bypasses RLS). Other operations use RLS policies.';
