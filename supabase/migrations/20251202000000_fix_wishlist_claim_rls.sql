-- Fix RLS policy for claiming/unclaiming wishlist items
-- Simplified approach: RLS checks visibility, application code handles business rules
-- This is safe and non-destructive - only modifies the policy, not the data

-- Drop the existing restrictive claim policy
DROP POLICY IF EXISTS "Users can claim visible wishlist items" ON wishlist_items;

-- Create a simpler policy that allows users to update items they can view
-- Business rules (who can claim/unclaim) are enforced in the application layer:
--   - claimWishlistItem: checks neq("user_id", user.id) and is("claimed_by", null)
--   - unclaimWishlistItem: checks eq("claimed_by", user.id)
--   - markAsPurchased: checks eq("claimed_by", user.id)
CREATE POLICY "Users can claim visible wishlist items"
  ON wishlist_items FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND
    auth.uid() != user_id AND
    can_view_wishlist_item(user_id, auth.uid(), privacy_settings)
  );
