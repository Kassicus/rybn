-- =================================================================
-- Fix Gift Group INSERT RLS Policy
-- Use existing is_group_member function to avoid RLS issues
-- =================================================================

-- Drop the problematic policy
DROP POLICY IF EXISTS "Users can create gift groups in their groups" ON gift_groups;

-- Recreate using the is_group_member security definer function
CREATE POLICY "Users can create gift groups in their groups"
  ON gift_groups FOR INSERT
  WITH CHECK (
    auth.uid() = created_by AND
    is_group_member(group_id, auth.uid())
  );
