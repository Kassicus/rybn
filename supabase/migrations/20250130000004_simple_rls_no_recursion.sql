-- COMPLETELY BREAK RLS RECURSION
-- Strategy: Only check columns on the SAME table, no cross-table EXISTS checks

-- Drop existing policies
DROP POLICY IF EXISTS "group_gifts_select" ON group_gifts;
DROP POLICY IF EXISTS "group_gift_members_select" ON group_gift_members;

-- =================================================================
-- group_gifts: ONLY allow creators (no membership check)
-- =================================================================
CREATE POLICY "group_gifts_select"
  ON group_gifts FOR SELECT
  USING (created_by = auth.uid());

-- =================================================================
-- group_gift_members: ONLY allow viewing own membership
-- =================================================================
CREATE POLICY "group_gift_members_select"
  ON group_gift_members FOR SELECT
  USING (user_id = auth.uid());

-- Note: This means members will need to check their membership FIRST,
-- then use that to determine if they can access the gift.
-- The application code already does this check in getGroupGiftById()
