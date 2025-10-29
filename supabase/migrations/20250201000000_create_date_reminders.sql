-- =================================================================
-- Date Reminders System Migration
-- Creates tables and functions for birthday/anniversary reminders
-- =================================================================

-- 1. Create date_notifications table to track sent notifications
CREATE TABLE IF NOT EXISTS date_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who is being notified
  notified_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Who is celebrating
  celebrant_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- What type of date ('birthday' or 'anniversary')
  field_name TEXT NOT NULL CHECK (field_name IN ('birthday', 'anniversary')),

  -- Which group context triggered this notification
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,

  -- When the celebration occurs (stored as MM-DD for recurring dates)
  celebration_date DATE NOT NULL,

  -- Which year this notification was for
  notification_year INTEGER NOT NULL,

  -- Notification tracking
  email_sent BOOLEAN DEFAULT FALSE,
  email_sent_at TIMESTAMPTZ,
  banner_shown BOOLEAN DEFAULT TRUE,
  banner_dismissed BOOLEAN DEFAULT FALSE,
  banner_dismissed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Ensure we don't send duplicate notifications
  UNIQUE(notified_user_id, celebrant_id, field_name, notification_year, group_id)
);

-- 2. Create indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_date_notifications_notified_user
  ON date_notifications(notified_user_id);

CREATE INDEX IF NOT EXISTS idx_date_notifications_celebrant
  ON date_notifications(celebrant_id);

CREATE INDEX IF NOT EXISTS idx_date_notifications_year
  ON date_notifications(notification_year);

CREATE INDEX IF NOT EXISTS idx_date_notifications_banner
  ON date_notifications(notified_user_id, banner_shown, banner_dismissed)
  WHERE banner_shown = TRUE AND banner_dismissed = FALSE;

-- 3. Enable RLS
ALTER TABLE date_notifications ENABLE ROW LEVEL SECURITY;

-- 4. Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view their own notifications" ON date_notifications;
DROP POLICY IF EXISTS "Users can update their own notifications" ON date_notifications;
DROP POLICY IF EXISTS "System can insert notifications" ON date_notifications;

-- 5. RLS Policies
-- Users can only see notifications meant for them
CREATE POLICY "Users can view their own notifications"
  ON date_notifications FOR SELECT
  USING (auth.uid() = notified_user_id);

-- Users can update only their own notifications (for dismissing banners)
CREATE POLICY "Users can update their own notifications"
  ON date_notifications FOR UPDATE
  USING (auth.uid() = notified_user_id)
  WITH CHECK (auth.uid() = notified_user_id);

-- System/service role can insert notifications
CREATE POLICY "System can insert notifications"
  ON date_notifications FOR INSERT
  WITH CHECK (true);

-- 6. Create function to get upcoming dates that need notifications
CREATE OR REPLACE FUNCTION get_upcoming_dates_for_notifications(
  days_ahead INTEGER DEFAULT 1,
  target_year INTEGER DEFAULT EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
)
RETURNS TABLE (
  celebrant_id UUID,
  celebrant_username TEXT,
  field_name TEXT,
  field_value TEXT,
  celebration_date DATE,
  group_id UUID,
  group_name TEXT,
  group_type group_type,
  notified_user_id UUID,
  notified_user_email TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT DISTINCT
    pi.user_id AS celebrant_id,
    up.username AS celebrant_username,
    pi.field_name,
    pi.field_value,
    -- Build full date with target year
    (target_year || '-' || SUBSTRING(pi.field_value FROM 6 FOR 5))::DATE AS celebration_date,
    g.id AS group_id,
    g.name AS group_name,
    g.type AS group_type,
    gm.user_id AS notified_user_id,
    au.email AS notified_user_email
  FROM profile_info pi
  INNER JOIN user_profiles up ON pi.user_id = up.id
  INNER JOIN auth.users au_celebrant ON pi.user_id = au_celebrant.id
  -- Get all groups the celebrant is in
  INNER JOIN group_members gm_celebrant ON pi.user_id = gm_celebrant.user_id
  INNER JOIN groups g ON gm_celebrant.group_id = g.id
  -- Get all other members in those groups
  INNER JOIN group_members gm ON g.id = gm.group_id AND gm.user_id != pi.user_id
  INNER JOIN auth.users au ON gm.user_id = au.id
  WHERE
    -- Only dates category
    pi.category = 'dates'
    -- Only birthday and anniversary
    AND pi.field_name IN ('birthday', 'anniversary')
    -- Must have a value
    AND pi.field_value IS NOT NULL
    AND pi.field_value != ''
    -- Check if the date is coming up (within days_ahead)
    AND (target_year || '-' || SUBSTRING(pi.field_value FROM 6 FOR 5))::DATE
      BETWEEN CURRENT_DATE AND (CURRENT_DATE + (days_ahead || ' days')::INTERVAL)::DATE
    -- Check privacy: user can view this field
    AND can_view_field(pi.user_id, gm.user_id, pi.privacy_settings)
    -- Ensure notification hasn't been sent this year
    AND NOT EXISTS (
      SELECT 1 FROM date_notifications dn
      WHERE dn.celebrant_id = pi.user_id
        AND dn.notified_user_id = gm.user_id
        AND dn.field_name = pi.field_name
        AND dn.notification_year = target_year
        AND dn.group_id = g.id
    );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 7. Create function to check for dates today (for quick checks)
CREATE OR REPLACE FUNCTION get_dates_today_for_user(
  p_user_id UUID
)
RETURNS TABLE (
  celebrant_id UUID,
  celebrant_username TEXT,
  celebrant_display_name TEXT,
  field_name TEXT,
  celebration_date DATE,
  group_id UUID,
  group_name TEXT,
  group_type group_type,
  notification_id UUID,
  banner_dismissed BOOLEAN
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    dn.celebrant_id,
    up.username AS celebrant_username,
    up.display_name AS celebrant_display_name,
    dn.field_name,
    dn.celebration_date,
    dn.group_id,
    g.name AS group_name,
    g.type AS group_type,
    dn.id AS notification_id,
    dn.banner_dismissed
  FROM date_notifications dn
  INNER JOIN user_profiles up ON dn.celebrant_id = up.id
  INNER JOIN groups g ON dn.group_id = g.id
  WHERE
    dn.notified_user_id = p_user_id
    AND dn.notification_year = EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER
    AND dn.celebration_date = CURRENT_DATE
    AND dn.banner_shown = TRUE
    AND dn.banner_dismissed = FALSE
  ORDER BY dn.created_at DESC;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- 8. Create trigger function for updating timestamps
CREATE OR REPLACE FUNCTION update_date_notifications_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 9. Create trigger
DROP TRIGGER IF EXISTS update_date_notifications_updated_at_trigger ON date_notifications;

CREATE TRIGGER update_date_notifications_updated_at_trigger
  BEFORE UPDATE ON date_notifications
  FOR EACH ROW
  EXECUTE FUNCTION update_date_notifications_updated_at();

-- 10. Grant permissions to authenticated users
GRANT SELECT, UPDATE ON date_notifications TO authenticated;

-- 11. Grant usage on functions
GRANT EXECUTE ON FUNCTION get_upcoming_dates_for_notifications(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION get_dates_today_for_user(UUID) TO authenticated;
