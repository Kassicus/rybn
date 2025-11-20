-- Fix infinite recursion when deleting groups with cascade
-- Problem: When deleting a group, cascade deletes cause infinite recursion
-- because group_gift_members DELETE policy checks group_gifts table which is being deleted
-- Solution: Remove cross-table check from DELETE policy and use admin client for creator deletes

-- =================================================================
-- Drop problematic DELETE and UPDATE policies
-- =================================================================

DROP POLICY IF EXISTS "group_gift_members_delete" ON group_gift_members;
DROP POLICY IF EXISTS "group_gift_members_update" ON group_gift_members;
DROP POLICY IF EXISTS "Users can leave gift groups" ON group_gift_members;
DROP POLICY IF EXISTS "Gift group creators can remove members" ON group_gift_members;
DROP POLICY IF EXISTS "Users can update their own membership" ON group_gift_members;

-- =================================================================
-- Create simplified policies that work with CASCADE deletes
-- =================================================================

-- DELETE: Only allow users to remove their own membership
-- For creator deletions, use admin client in application code
CREATE POLICY "group_gift_members_delete"
  ON group_gift_members FOR DELETE
  USING (
    -- Users can delete their own membership (leave group gift)
    user_id = auth.uid()
    -- Note: For removing other members, use admin client with proper authorization
    -- CASCADE deletes from group_gifts will work because they bypass RLS
  );

-- UPDATE: Allow users to update their own contribution amount and payment status
CREATE POLICY "group_gift_members_update"
  ON group_gift_members FOR UPDATE
  USING (user_id = auth.uid());

-- =================================================================
-- Update DELETE action to use admin client
-- =================================================================

COMMENT ON POLICY "group_gift_members_delete" ON group_gift_members IS
'Allows users to leave gift groups by deleting their own membership.
For removing other members, the application must use the admin client with proper authorization checks.
CASCADE deletes from parent tables (group_gifts) work automatically without RLS checks.';

COMMENT ON POLICY "group_gift_members_update" ON group_gift_members IS
'Allows users to update their own contribution amount and payment status.';
