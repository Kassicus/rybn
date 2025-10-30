-- =================================================================
-- Add Wishlist Privacy Constraint
-- Adds constraint after data migration is verified
-- =================================================================

-- Drop constraint if it exists, then re-add it
ALTER TABLE wishlist_items DROP CONSTRAINT IF EXISTS valid_wishlist_privacy_settings;

-- Add constraint for the wishlist privacy format
ALTER TABLE wishlist_items ADD CONSTRAINT valid_wishlist_privacy_settings
  CHECK (
    -- Must have visibleToGroupTypes array
    privacy_settings ? 'visibleToGroupTypes' AND
    jsonb_typeof(privacy_settings->'visibleToGroupTypes') = 'array' AND
    -- restrictToGroup must be a string, null JSON value, or absent
    (
      NOT (privacy_settings ? 'restrictToGroup') OR
      jsonb_typeof(privacy_settings->'restrictToGroup') = 'null' OR
      jsonb_typeof(privacy_settings->'restrictToGroup') = 'string'
    )
  );
