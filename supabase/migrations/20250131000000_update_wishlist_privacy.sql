-- =================================================================
-- Update Wishlist Privacy Settings
-- Migrates from group-type based privacy to global visibility
-- with optional group-specific restrictions
-- =================================================================

-- Drop the existing privacy constraint first
ALTER TABLE wishlist_items DROP CONSTRAINT IF EXISTS valid_wishlist_privacy_settings;

-- Update existing wishlist items to use the new privacy format
-- Convert from visibleToGroupTypes array to default privacy level
UPDATE wishlist_items
SET privacy_settings =
  CASE
    -- If visibleToGroupTypes is empty, set to private
    WHEN jsonb_array_length(privacy_settings->'visibleToGroupTypes') = 0
      THEN '{"default": "private", "restrictToGroups": []}'::jsonb

    -- If contains all group types, set to group (visible to all group members)
    WHEN privacy_settings->'visibleToGroupTypes' @> '["family", "friends", "work", "custom"]'::jsonb
      THEN '{"default": "group", "restrictToGroups": []}'::jsonb

    -- If contains family, set to family
    WHEN privacy_settings->'visibleToGroupTypes' @> '["family"]'::jsonb
      THEN '{"default": "family", "restrictToGroups": []}'::jsonb

    -- If contains friends, set to friends
    WHEN privacy_settings->'visibleToGroupTypes' @> '["friends"]'::jsonb
      THEN '{"default": "friends", "restrictToGroups": []}'::jsonb

    -- Default to group for any other combinations
    ELSE '{"default": "group", "restrictToGroups": []}'::jsonb
  END
WHERE privacy_settings ? 'visibleToGroupTypes';

-- Update the default value for new items
ALTER TABLE wishlist_items
  ALTER COLUMN privacy_settings
  SET DEFAULT '{"default": "group", "restrictToGroups": []}'::jsonb;

-- Update the privacy_settings column comment
COMMENT ON COLUMN wishlist_items.privacy_settings IS
'Privacy settings in format: {default: "private|friends|family|group|public", restrictToGroups: [group_ids]}';

-- Add new constraint for the updated privacy format
ALTER TABLE wishlist_items ADD CONSTRAINT valid_wishlist_privacy_settings
  CHECK (
    -- Must have a default privacy level
    privacy_settings ? 'default' AND
    privacy_settings->>'default' IN ('private', 'friends', 'family', 'group', 'public') AND
    -- restrictToGroups must be an array if present
    (
      NOT (privacy_settings ? 'restrictToGroups') OR
      jsonb_typeof(privacy_settings->'restrictToGroups') = 'array'
    )
  );

-- Update the can_view_wishlist_item function with new logic
CREATE OR REPLACE FUNCTION can_view_wishlist_item(
  item_owner_id UUID,
  viewer_id UUID,
  privacy_settings JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  default_privacy TEXT;
  restrict_to_groups UUID[];
  shared_group RECORD;
  viewer_group_type group_type;
BEGIN
  -- Owner can always view their own items
  IF item_owner_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Extract default privacy level
  default_privacy := privacy_settings->>'default';

  -- If default is private, only owner can see
  IF default_privacy = 'private' THEN
    RETURN FALSE;
  END IF;

  -- If default is public, everyone can see (unless restricted to groups)
  -- Check for group restrictions first
  IF privacy_settings ? 'restrictToGroups' THEN
    restrict_to_groups := ARRAY(
      SELECT (jsonb_array_elements_text(privacy_settings->'restrictToGroups'))::UUID
    );

    -- If restrictToGroups is set and not empty, check if viewer is in any of those groups
    IF array_length(restrict_to_groups, 1) > 0 THEN
      -- Check if viewer shares any of the restricted groups with owner
      FOR shared_group IN
        SELECT * FROM get_shared_groups(viewer_id, item_owner_id)
      LOOP
        IF shared_group.group_id = ANY(restrict_to_groups) THEN
          RETURN TRUE;
        END IF;
      END LOOP;

      -- Viewer is not in any of the restricted groups
      RETURN FALSE;
    END IF;
  END IF;

  -- No group restrictions, apply default privacy level
  IF default_privacy = 'public' THEN
    RETURN TRUE;
  END IF;

  -- For group/friends/family, check shared groups with matching types
  FOR shared_group IN
    SELECT * FROM get_shared_groups(viewer_id, item_owner_id)
  LOOP
    viewer_group_type := shared_group.group_type;

    -- Check based on default privacy level
    CASE default_privacy
      WHEN 'group' THEN
        -- Any shared group is sufficient
        RETURN TRUE;

      WHEN 'friends' THEN
        -- Must be in a friends-type group
        IF viewer_group_type = 'friends' THEN
          RETURN TRUE;
        END IF;

      WHEN 'family' THEN
        -- Must be in a family-type group
        IF viewer_group_type = 'family' THEN
          RETURN TRUE;
        END IF;

      ELSE
        -- Unknown privacy level, default to private
        RETURN FALSE;
    END CASE;
  END LOOP;

  -- No matching groups found
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION can_view_wishlist_item(UUID, UUID, JSONB) TO authenticated;
