-- =================================================================
-- Fix Gift Group RLS Infinite Recursion
-- =================================================================

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view gift group members" ON gift_group_members;
DROP POLICY IF EXISTS "Gift group creators can add members" ON gift_group_members;

-- Create a security definer function to check gift group membership
-- This bypasses RLS to avoid infinite recursion
CREATE OR REPLACE FUNCTION is_gift_group_member(
  check_gift_group_id UUID,
  check_user_id UUID
) RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM gift_group_members
    WHERE gift_group_id = check_gift_group_id
    AND user_id = check_user_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION is_gift_group_member(UUID, UUID) TO authenticated;

-- Recreate the policies using the security definer function
CREATE POLICY "Users can view gift group members"
  ON gift_group_members FOR SELECT
  USING (
    is_gift_group_member(gift_group_id, auth.uid())
  );

-- Gift group creators can add members
CREATE POLICY "Gift group creators can add members"
  ON gift_group_members FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM gift_groups
      WHERE gift_groups.id = gift_group_members.gift_group_id
      AND gift_groups.created_by = auth.uid()
    )
  );
