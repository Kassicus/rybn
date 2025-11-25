-- =================================================================
-- Gift Tracking System Migration
-- Creates gift_recipients and tracked_gifts tables
-- For privately tracking gifts the user is buying for others
-- =================================================================

-- Create gift status enum
CREATE TYPE gift_status AS ENUM ('planned', 'ordered', 'arrived', 'wrapped', 'given');

-- =================================================================
-- Table: gift_recipients
-- People the user is buying gifts for (not linked to app users)
-- =================================================================

CREATE TABLE IF NOT EXISTS gift_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  notes TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- =================================================================
-- Table: tracked_gifts
-- Individual gifts being tracked for recipients
-- =================================================================

CREATE TABLE IF NOT EXISTS tracked_gifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  recipient_id UUID REFERENCES gift_recipients(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  photo_url TEXT,
  product_link TEXT,
  price DECIMAL(10, 2),
  status gift_status NOT NULL DEFAULT 'planned',
  status_changed_at TIMESTAMPTZ DEFAULT NOW(),
  occasion TEXT,
  season_year INTEGER DEFAULT EXTRACT(YEAR FROM NOW()),
  notes TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =================================================================
-- Indexes
-- =================================================================

-- gift_recipients indexes
CREATE INDEX IF NOT EXISTS idx_gift_recipients_user_id ON gift_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_gift_recipients_archived ON gift_recipients(user_id, is_archived);

-- tracked_gifts indexes
CREATE INDEX IF NOT EXISTS idx_tracked_gifts_user_id ON tracked_gifts(user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_gifts_recipient_id ON tracked_gifts(recipient_id);
CREATE INDEX IF NOT EXISTS idx_tracked_gifts_status ON tracked_gifts(user_id, status);
CREATE INDEX IF NOT EXISTS idx_tracked_gifts_season ON tracked_gifts(user_id, season_year);
CREATE INDEX IF NOT EXISTS idx_tracked_gifts_archived ON tracked_gifts(user_id, is_archived);

-- =================================================================
-- Enable RLS
-- =================================================================

ALTER TABLE gift_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracked_gifts ENABLE ROW LEVEL SECURITY;

-- =================================================================
-- RLS Policies for gift_recipients
-- Users can only manage their own recipients
-- =================================================================

CREATE POLICY "Users can view their own recipients"
  ON gift_recipients FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own recipients"
  ON gift_recipients FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own recipients"
  ON gift_recipients FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own recipients"
  ON gift_recipients FOR DELETE
  USING (auth.uid() = user_id);

-- =================================================================
-- RLS Policies for tracked_gifts
-- Users can only manage their own tracked gifts
-- =================================================================

CREATE POLICY "Users can view their own tracked gifts"
  ON tracked_gifts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own tracked gifts"
  ON tracked_gifts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tracked gifts"
  ON tracked_gifts FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tracked gifts"
  ON tracked_gifts FOR DELETE
  USING (auth.uid() = user_id);

-- =================================================================
-- Triggers
-- =================================================================

-- Update gift_recipients updated_at
CREATE TRIGGER update_gift_recipients_updated_at
  BEFORE UPDATE ON gift_recipients
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update tracked_gifts updated_at
CREATE TRIGGER update_tracked_gifts_updated_at
  BEFORE UPDATE ON tracked_gifts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update status_changed_at when status changes
CREATE OR REPLACE FUNCTION update_gift_status_changed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    NEW.status_changed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_tracked_gifts_status_changed_at
  BEFORE UPDATE ON tracked_gifts
  FOR EACH ROW
  EXECUTE FUNCTION update_gift_status_changed_at();

-- =================================================================
-- Constraints
-- =================================================================

-- gift_recipients constraints
ALTER TABLE gift_recipients ADD CONSTRAINT recipient_name_length
  CHECK (char_length(name) >= 1 AND char_length(name) <= 100);

ALTER TABLE gift_recipients ADD CONSTRAINT recipient_notes_length
  CHECK (notes IS NULL OR char_length(notes) <= 500);

-- tracked_gifts constraints
ALTER TABLE tracked_gifts ADD CONSTRAINT gift_name_length
  CHECK (char_length(name) >= 1 AND char_length(name) <= 200);

ALTER TABLE tracked_gifts ADD CONSTRAINT gift_description_length
  CHECK (description IS NULL OR char_length(description) <= 1000);

ALTER TABLE tracked_gifts ADD CONSTRAINT gift_notes_length
  CHECK (notes IS NULL OR char_length(notes) <= 1000);

ALTER TABLE tracked_gifts ADD CONSTRAINT gift_occasion_length
  CHECK (occasion IS NULL OR char_length(occasion) <= 100);

ALTER TABLE tracked_gifts ADD CONSTRAINT gift_price_positive
  CHECK (price IS NULL OR price >= 0);

-- =================================================================
-- Comments
-- =================================================================

COMMENT ON TABLE gift_recipients IS
'Recipients (people) that a user is buying/tracking gifts for. Private to each user, not linked to app users.';

COMMENT ON TABLE tracked_gifts IS
'Individual gifts being tracked for recipients. Includes status workflow from planned to given.';

COMMENT ON COLUMN tracked_gifts.status IS
'Gift status workflow: planned -> ordered -> arrived -> wrapped -> given';

COMMENT ON COLUMN tracked_gifts.status_changed_at IS
'Timestamp when status was last changed, automatically updated by trigger';

COMMENT ON COLUMN tracked_gifts.occasion IS
'Optional occasion (e.g., "Birthday", "Christmas", "Wedding")';

COMMENT ON COLUMN tracked_gifts.season_year IS
'Year for seasonal tracking (e.g., 2025 for "Christmas 2025"), defaults to current year';

COMMENT ON TYPE gift_status IS
'Status workflow for tracked gifts: planned -> ordered -> arrived -> wrapped -> given';
