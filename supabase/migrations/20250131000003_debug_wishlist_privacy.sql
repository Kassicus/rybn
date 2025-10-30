-- Debug: Show any wishlist items that would violate the constraint
DO $$
DECLARE
  invalid_item RECORD;
BEGIN
  RAISE NOTICE 'Checking for invalid wishlist_items...';

  FOR invalid_item IN
    SELECT
      id,
      user_id,
      title,
      privacy_settings,
      CASE
        WHEN NOT (privacy_settings ? 'visibleToGroupTypes') THEN 'Missing visibleToGroupTypes'
        WHEN jsonb_typeof(privacy_settings->'visibleToGroupTypes') != 'array' THEN 'visibleToGroupTypes is not array'
        WHEN privacy_settings ? 'restrictToGroup' AND
             privacy_settings->'restrictToGroup' IS NOT NULL AND
             jsonb_typeof(privacy_settings->'restrictToGroup') != 'string' THEN 'restrictToGroup is invalid type'
        ELSE 'Unknown issue'
      END as issue
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
  LOOP
    RAISE NOTICE 'Invalid item ID: %, Issue: %, Privacy: %',
      invalid_item.id, invalid_item.issue, invalid_item.privacy_settings;
  END LOOP;
END $$;

-- Fix all invalid items
UPDATE wishlist_items
SET privacy_settings = '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb
WHERE NOT (
  privacy_settings ? 'visibleToGroupTypes' AND
  jsonb_typeof(privacy_settings->'visibleToGroupTypes') = 'array' AND
  (
    NOT (privacy_settings ? 'restrictToGroup') OR
    privacy_settings->'restrictToGroup' IS NULL OR
    jsonb_typeof(privacy_settings->'restrictToGroup') = 'string'
  )
);
