-- Add out of stock tracking to wishlist items
-- This follows the same pattern as claiming: visible to others but hidden from the item owner

ALTER TABLE wishlist_items
ADD COLUMN out_of_stock_marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
ADD COLUMN out_of_stock_marked_at timestamptz;

-- Add index for efficient queries
CREATE INDEX idx_wishlist_items_out_of_stock ON wishlist_items(out_of_stock_marked_by) WHERE out_of_stock_marked_by IS NOT NULL;

COMMENT ON COLUMN wishlist_items.out_of_stock_marked_by IS 'User who marked this item as out of stock';
COMMENT ON COLUMN wishlist_items.out_of_stock_marked_at IS 'When the item was marked as out of stock';
