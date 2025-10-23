-- =================================================================
-- Fix Privacy Settings Constraint to Accept New Array-Based Format
-- Removes old constraint and adds new one supporting both formats
-- =================================================================

-- Drop the old constraint that requires 'default' field
ALTER TABLE profile_info DROP CONSTRAINT IF EXISTS valid_privacy_settings;

-- Add new constraint that accepts both old and new formats
-- Old format: {"default": "private", "overrides": {...}}
-- New format: {"visibleToGroupTypes": ["family", "friends"], "overrides": {...}}
ALTER TABLE profile_info ADD CONSTRAINT valid_privacy_settings
  CHECK (
    -- New format: must have visibleToGroupTypes as an array
    (
      privacy_settings ? 'visibleToGroupTypes' AND
      jsonb_typeof(privacy_settings->'visibleToGroupTypes') = 'array'
    )
    OR
    -- Legacy format: must have default as a valid privacy level
    (
      privacy_settings ? 'default' AND
      (privacy_settings->>'default')::privacy_level IS NOT NULL
    )
  );

-- Add comment explaining the constraint
COMMENT ON CONSTRAINT valid_privacy_settings ON profile_info IS
'Accepts both new array-based format {visibleToGroupTypes: [...]} and legacy format {default: "..."}';
