-- =================================================================
-- Update Privacy System to Array-Based Group Type Selection
-- Allows users to select multiple group types (family, friends, work, custom)
-- =================================================================

-- Update the can_view_field function to work with array-based privacy
CREATE OR REPLACE FUNCTION can_view_field(
  field_owner_id UUID,
  viewer_id UUID,
  privacy_settings JSONB
) RETURNS BOOLEAN AS $$
DECLARE
  shared_groups RECORD;
  visible_group_types TEXT[];
  viewer_group_type group_type;
BEGIN
  -- Owner can always view their own fields
  IF field_owner_id = viewer_id THEN
    RETURN TRUE;
  END IF;

  -- Try to extract visibleToGroupTypes array (new format)
  IF privacy_settings ? 'visibleToGroupTypes' THEN
    visible_group_types := ARRAY(
      SELECT jsonb_array_elements_text(privacy_settings->'visibleToGroupTypes')
    );

    -- If array is empty, field is private
    IF array_length(visible_group_types, 1) IS NULL OR array_length(visible_group_types, 1) = 0 THEN
      RETURN FALSE;
    END IF;

    -- Check if viewer shares any groups with field owner
    FOR shared_groups IN
      SELECT * FROM get_shared_groups(viewer_id, field_owner_id)
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

  -- Legacy format support - default privacy level
  IF privacy_settings ? 'default' THEN
    DECLARE
      default_level privacy_level;
    BEGIN
      default_level := (privacy_settings->>'default')::privacy_level;

      -- If public, return immediately
      IF default_level = 'public' THEN
        RETURN TRUE;
      END IF;

      -- If private with no overrides, return false
      IF default_level = 'private' THEN
        RETURN FALSE;
      END IF;

      -- Check group-based access
      FOR shared_groups IN
        SELECT * FROM get_shared_groups(viewer_id, field_owner_id)
      LOOP
        IF default_level = 'group' THEN
          RETURN TRUE;
        ELSIF default_level = 'family' AND shared_groups.group_type = 'family' THEN
          RETURN TRUE;
        ELSIF default_level = 'friends' AND shared_groups.group_type = 'friends' THEN
          RETURN TRUE;
        END IF;
      END LOOP;
    END;
  END IF;

  -- If we got here, user can't view
  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION can_view_field(UUID, UUID, JSONB) TO authenticated;

-- Add a comment explaining the new format
COMMENT ON FUNCTION can_view_field IS
'Checks if a viewer can see a profile field based on privacy settings.
New format: {visibleToGroupTypes: ["family", "friends", "work", "custom"]}
Legacy format: {default: "private"|"group"|"friends"|"family"|"public"}';
