-- =================================================================
-- Update Wishlist Privacy to Group Types System
-- Changes from privacy level to group types (matching profile system)
-- with optional single group restriction
-- =================================================================

-- Drop the existing privacy constraint first
ALTER TABLE wishlist_items DROP CONSTRAINT IF EXISTS valid_wishlist_privacy_settings;

-- Update existing wishlist items to use group types format
-- Convert from {default: level, restrictToGroups: []} to {visibleToGroupTypes: [], restrictToGroup: null}
UPDATE wishlist_items
SET privacy_settings =
  CASE
    -- Private (empty array)
    WHEN privacy_settings->>'default' = 'private'
      THEN '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb

    -- Friends only
    WHEN privacy_settings->>'default' = 'friends'
      THEN '{"visibleToGroupTypes": ["friends"], "restrictToGroup": null}'::jsonb

    -- Family only
    WHEN privacy_settings->>'default' = 'family'
      THEN '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'::jsonb

    -- Group (all types)
    WHEN privacy_settings->>'default' IN ('group', 'public')
      THEN '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb

    -- If already has visibleToGroupTypes (from old migration), leave as-is
    WHEN privacy_settings ? 'visibleToGroupTypes'
      THEN privacy_settings || '{"restrictToGroup": null}'::jsonb

    -- Default to all groups for anything else
    ELSE '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb
  END;

-- Update the default value for new items
ALTER TABLE wishlist_items
  ALTER COLUMN privacy_settings
  SET DEFAULT '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb;

-- Update the privacy_settings column comment
COMMENT ON COLUMN wishlist_items.privacy_settings IS
'Privacy settings in format: {visibleToGroupTypes: ["family", "friends", "work", "custom"], restrictToGroup: "group_id" | null}';

-- Update the can_view_wishlist_item function with group types logic
CREATE OR REPLACE FUNCTION can_view_wishlist_item(
  item_owner_id UUID,
  viewer_id UUID,
  privacy_settings JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  visible_group_types TEXT[];
  restrict_to_group UUID;
  shared_group RECORD;
  viewer_group_type group_type;
BEGIN
  -- Owner can always view their own items
  IF item_owner_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Check for single group restriction first
  IF privacy_settings ? 'restrictToGroup' AND privacy_settings->>'restrictToGroup' IS NOT NULL THEN
    restrict_to_group := (privacy_settings->>'restrictToGroup')::UUID;

    -- Check if viewer shares this specific group with owner
    FOR shared_group IN
      SELECT * FROM get_shared_groups(viewer_id, item_owner_id)
    LOOP
      IF shared_group.group_id = restrict_to_group THEN
        RETURN TRUE;
      END IF;
    END LOOP;

    -- Viewer is not in the restricted group
    RETURN FALSE;
  END IF;

  -- No group restriction, check visibleToGroupTypes
  IF privacy_settings ? 'visibleToGroupTypes' THEN
    visible_group_types := ARRAY(
      SELECT jsonb_array_elements_text(privacy_settings->'visibleToGroupTypes')
    );

    -- If array is empty, item is private
    IF array_length(visible_group_types, 1) IS NULL OR array_length(visible_group_types, 1) = 0 THEN
      RETURN FALSE;
    END IF;

    -- Check if viewer shares any groups with matching types
    FOR shared_group IN
      SELECT * FROM get_shared_groups(viewer_id, item_owner_id)
    LOOP
      viewer_group_type := shared_group.group_type;

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

-- Note: Constraint will be added in a separate migration after verifying data format
