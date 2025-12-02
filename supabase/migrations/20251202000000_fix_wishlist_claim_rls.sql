-- Fix RLS policy for claiming/unclaiming wishlist items
-- The previous policy only allowed setting claimed_by to the current user,
-- but didn't allow setting it back to null (unclaiming)

-- Drop the existing claim policy
DROP POLICY IF EXISTS "Users can claim visible wishlist items" ON wishlist_items;

-- Create updated policy that allows:
-- 1. Claiming an unclaimed item (setting claimed_by from null to your user id)
-- 2. Unclaiming your claimed item (setting claimed_by from your user id to null)
-- 3. Updating your claim (e.g., marking as purchased while remaining the claimer)
CREATE POLICY "Users can claim visible wishlist items"
  ON wishlist_items FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND
    auth.uid() != user_id AND
    can_view_wishlist_item(user_id, auth.uid(), privacy_settings) AND
    -- You can only update if: item is unclaimed OR you are the current claimer
    (claimed_by IS NULL OR claimed_by = auth.uid())
  )
  WITH CHECK (
    -- After update: claimed_by must be null (unclaiming) or your user id (claiming/keeping)
    (claimed_by IS NULL OR claimed_by = auth.uid())
  );

-- Add comment explaining the policy
COMMENT ON POLICY "Users can claim visible wishlist items" ON wishlist_items IS
'Allows users to claim unclaimed items, unclaim their own claims, and update their claim status (e.g., mark as purchased). Users can only modify items they can view and cannot claim items already claimed by others.';
