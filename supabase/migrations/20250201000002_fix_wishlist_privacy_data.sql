-- =================================================================
-- Fix Wishlist Privacy Data
-- Ensures all wishlist items have correct privacy_settings format
-- =================================================================

-- Show diagnostic info about current data (this will appear in logs)
DO $$
DECLARE
  total_items INTEGER;
  invalid_items INTEGER;
  sample_invalid RECORD;
BEGIN
  -- Count total items
  SELECT COUNT(*) INTO total_items FROM wishlist_items;
  RAISE NOTICE 'Total wishlist items: %', total_items;

  -- Count invalid items
  SELECT COUNT(*) INTO invalid_items
  FROM wishlist_items
  WHERE NOT (
    privacy_settings ? 'visibleToGroupTypes' AND
    jsonb_typeof(privacy_settings->'visibleToGroupTypes') = 'array' AND
    (
      NOT (privacy_settings ? 'restrictToGroup') OR
      privacy_settings->'restrictToGroup' IS NULL OR
      jsonb_typeof(privacy_settings->'restrictToGroup') = 'string'
    )
  );
  RAISE NOTICE 'Invalid wishlist items: %', invalid_items;

  -- Show a sample of invalid data
  IF invalid_items > 0 THEN
    FOR sample_invalid IN
      SELECT id, user_id, title, privacy_settings
      FROM wishlist_items
      WHERE NOT (
        privacy_settings ? 'visibleToGroupTypes' AND
        jsonb_typeof(privacy_settings->'visibleToGroupTypes') = 'array' AND
        (
          NOT (privacy_settings ? 'restrictToGroup') OR
          privacy_settings->'restrictToGroup' IS NULL OR
          jsonb_typeof(privacy_settings->'restrictToGroup') = 'string'
        )
      )
      LIMIT 3
    LOOP
      RAISE NOTICE 'Sample invalid item - ID: %, Privacy: %',
        sample_invalid.id, sample_invalid.privacy_settings;
    END LOOP;
  END IF;
END $$;

-- Fix 1: Items with old "default" format - convert to new format
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

    -- Group or public (all types)
    WHEN privacy_settings->>'default' IN ('group', 'public')
      THEN '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb

    -- Default fallback
    ELSE '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb
  END
WHERE privacy_settings ? 'default';

-- Fix 2: Items with visibleToGroupTypes but missing restrictToGroup
UPDATE wishlist_items
SET privacy_settings = privacy_settings || '{"restrictToGroup": null}'::jsonb
WHERE
  privacy_settings ? 'visibleToGroupTypes' AND
  NOT (privacy_settings ? 'restrictToGroup');

-- Fix 3: Items with restrictToGroup but it's not null and not a string
-- (e.g., if it's an array or object by mistake)
UPDATE wishlist_items
SET privacy_settings = jsonb_set(privacy_settings, '{restrictToGroup}', 'null'::jsonb)
WHERE
  privacy_settings ? 'restrictToGroup' AND
  privacy_settings->'restrictToGroup' IS NOT NULL AND
  jsonb_typeof(privacy_settings->'restrictToGroup') != 'string';

-- Fix 4: Items missing visibleToGroupTypes entirely
UPDATE wishlist_items
SET privacy_settings = '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb
WHERE NOT (privacy_settings ? 'visibleToGroupTypes');

-- Fix 5: Items where visibleToGroupTypes is not an array
UPDATE wishlist_items
SET privacy_settings = jsonb_set(
  privacy_settings,
  '{visibleToGroupTypes}',
  '["family", "friends", "work", "custom"]'::jsonb
)
WHERE
  privacy_settings ? 'visibleToGroupTypes' AND
  jsonb_typeof(privacy_settings->'visibleToGroupTypes') != 'array';

-- Fix 6: Handle null privacy_settings
UPDATE wishlist_items
SET privacy_settings = '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb
WHERE privacy_settings IS NULL;

-- Verify all items are now valid
DO $$
DECLARE
  remaining_invalid INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_invalid
  FROM wishlist_items
  WHERE NOT (
    privacy_settings ? 'visibleToGroupTypes' AND
    jsonb_typeof(privacy_settings->'visibleToGroupTypes') = 'array' AND
    (
      NOT (privacy_settings ? 'restrictToGroup') OR
      privacy_settings->'restrictToGroup' IS NULL OR
      jsonb_typeof(privacy_settings->'restrictToGroup') = 'string'
    )
  );

  IF remaining_invalid > 0 THEN
    RAISE WARNING 'Still have % invalid wishlist items after fixes!', remaining_invalid;
  ELSE
    RAISE NOTICE 'All wishlist items now have valid privacy_settings format!';
  END IF;
END $$;
