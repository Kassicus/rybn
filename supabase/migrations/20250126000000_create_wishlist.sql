-- =================================================================
-- Wishlist System Migration
-- Creates wishlist_items table with per-item privacy controls
-- =================================================================

-- Create wishlist items table
CREATE TABLE IF NOT EXISTS wishlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT,
  price DECIMAL(10, 2),
  image_url TEXT,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high', 'must-have')),
  category TEXT,

  -- Privacy settings using the new array-based format
  privacy_settings JSONB NOT NULL DEFAULT '{"visibleToGroupTypes": [], "overrides": {}}',

  -- Claiming/purchasing tracking
  claimed_by UUID REFERENCES auth.users(id),
  claimed_at TIMESTAMPTZ,
  purchased BOOLEAN DEFAULT FALSE,
  purchased_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_wishlist_items_user_id ON wishlist_items(user_id);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_claimed_by ON wishlist_items(claimed_by);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_priority ON wishlist_items(priority);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_category ON wishlist_items(category);
CREATE INDEX IF NOT EXISTS idx_wishlist_items_privacy ON wishlist_items USING GIN(privacy_settings);

-- Enable RLS
ALTER TABLE wishlist_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Users can view their own wishlist items
CREATE POLICY "Users can view their own wishlist items"
  ON wishlist_items FOR SELECT
  USING (auth.uid() = user_id);

-- Users can view wishlist items based on privacy settings
CREATE POLICY "Users can view wishlist items based on privacy"
  ON wishlist_items FOR SELECT
  USING (
    auth.uid() IS NOT NULL AND
    auth.uid() != user_id AND
    can_view_wishlist_item(user_id, auth.uid(), privacy_settings)
  );

-- Users can create their own wishlist items
CREATE POLICY "Users can create their own wishlist items"
  ON wishlist_items FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own wishlist items
CREATE POLICY "Users can update their own wishlist items"
  ON wishlist_items FOR UPDATE
  USING (auth.uid() = user_id);

-- Users can delete their own wishlist items
CREATE POLICY "Users can delete their own wishlist items"
  ON wishlist_items FOR DELETE
  USING (auth.uid() = user_id);

-- Users can claim items on other users' wishlists if they can view them
CREATE POLICY "Users can claim visible wishlist items"
  ON wishlist_items FOR UPDATE
  USING (
    auth.uid() IS NOT NULL AND
    auth.uid() != user_id AND
    can_view_wishlist_item(user_id, auth.uid(), privacy_settings)
  )
  WITH CHECK (
    -- Only allow updating claim-related fields
    auth.uid() = claimed_by
  );

-- Helper function to check if viewer can see a wishlist item
CREATE OR REPLACE FUNCTION can_view_wishlist_item(
  item_owner_id UUID,
  viewer_id UUID,
  privacy_settings JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  shared_groups RECORD;
  visible_group_types TEXT[];
  viewer_group_type group_type;
BEGIN
  -- Owner can always view their own items
  IF item_owner_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Extract visibleToGroupTypes array
  IF privacy_settings ? 'visibleToGroupTypes' THEN
    visible_group_types := ARRAY(
      SELECT jsonb_array_elements_text(privacy_settings->'visibleToGroupTypes')
    );

    -- If array is empty, item is private
    IF array_length(visible_group_types, 1) IS NULL OR array_length(visible_group_types, 1) = 0 THEN
      RETURN FALSE;
    END IF;

    -- Check if viewer shares any groups with item owner
    FOR shared_groups IN
      SELECT * FROM get_shared_groups(viewer_id, item_owner_id)
    LOOP
      viewer_group_type := shared_groups.group_type;

      -- Check if the viewer's group type is in the visible array
      IF viewer_group_type::TEXT = ANY(visible_group_types) THEN
        RETURN TRUE;
      END IF;
    END LOOP;

    -- No matching group types found
    RETURN FALSE;
  END IF;

  -- If no privacy settings, default to private
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION can_view_wishlist_item(UUID, UUID, JSONB) TO authenticated;

-- Create trigger for updated_at
CREATE TRIGGER update_wishlist_items_updated_at
  BEFORE UPDATE ON wishlist_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add constraints
ALTER TABLE wishlist_items ADD CONSTRAINT valid_wishlist_privacy_settings
  CHECK (
    privacy_settings ? 'visibleToGroupTypes' AND
    jsonb_typeof(privacy_settings->'visibleToGroupTypes') = 'array'
  );

ALTER TABLE wishlist_items ADD CONSTRAINT valid_price
  CHECK (price IS NULL OR price >= 0);

ALTER TABLE wishlist_items ADD CONSTRAINT title_length
  CHECK (char_length(title) >= 1 AND char_length(title) <= 200);

-- Add comments
COMMENT ON TABLE wishlist_items IS
'Wishlist items with per-item privacy controls using group type arrays';

COMMENT ON COLUMN wishlist_items.privacy_settings IS
'Privacy settings in format: {visibleToGroupTypes: ["family", "friends", "work", "custom"]}';

COMMENT ON COLUMN wishlist_items.claimed_by IS
'User who has claimed this item for purchase (hidden from wishlist owner)';
