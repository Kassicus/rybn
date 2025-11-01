-- Fix infinite recursion in group_gift_members RLS policies
-- Strategy: Remove cross-table checks that cause recursion
-- Let application layer handle authorization with admin client

-- Drop existing problematic policies
DROP POLICY IF EXISTS "group_gift_members_select" ON group_gift_members;
DROP POLICY IF EXISTS "group_gift_members_insert" ON group_gift_members;

-- =================================================================
-- Simplified group_gift_members SELECT policy (no recursion)
-- =================================================================
CREATE POLICY "group_gift_members_select"
  ON group_gift_members FOR SELECT
  USING (
    -- You can always see your own membership
    user_id = auth.uid()
    OR
    -- Creators can see all members (direct column check, no subquery)
    EXISTS (
      SELECT 1 FROM group_gifts
      WHERE group_gifts.id = group_gift_members.group_gift_id
      AND group_gifts.created_by = auth.uid()
    )
  );

-- =================================================================
-- Simplified group_gift_members INSERT policy (no recursion)
-- Allow inserts only through admin client with app-level authorization
-- =================================================================
CREATE POLICY "group_gift_members_insert"
  ON group_gift_members FOR INSERT
  WITH CHECK (
    -- Only allow through service role (admin client)
    -- Application code must verify authorization before using admin client
    auth.jwt() ->> 'role' = 'service_role'
    OR
    -- Or allow if creator (direct check, no recursion)
    EXISTS (
      SELECT 1 FROM group_gifts
      WHERE group_gifts.id = group_gift_members.group_gift_id
      AND group_gifts.created_by = auth.uid()
    )
  );

COMMENT ON POLICY "group_gift_members_insert" ON group_gift_members IS
'Allows insertions via service role (admin client) or by group gift creator.
When using service role, application code MUST verify authorization:
- User is a member of the group gift, OR
- User is the creator of the group gift
- AND users being added are from groups the inviter shares with them';
