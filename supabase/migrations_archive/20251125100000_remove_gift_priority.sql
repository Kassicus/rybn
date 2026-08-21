-- =================================================================
-- Remove Gift Priority System
-- Drops the priority column and enum from tracked_gifts
-- =================================================================

-- Drop the priority column from tracked_gifts
ALTER TABLE tracked_gifts DROP COLUMN IF EXISTS priority;

-- Drop the index on priority (if it exists)
DROP INDEX IF EXISTS idx_tracked_gifts_priority;

-- Drop the gift_priority enum type
DROP TYPE IF EXISTS gift_priority;

-- Update comment on tracked_gifts table
COMMENT ON TABLE tracked_gifts IS
'Individual gifts being tracked for recipients. Includes status workflow from planned to given. Gifts are considered complete at the wrapped stage.';
