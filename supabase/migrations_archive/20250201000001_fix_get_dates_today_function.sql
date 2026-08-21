-- =================================================================
-- Fix get_dates_today_for_user Function
-- Removes DISTINCT since we have unique constraints, fixing ORDER BY issue
-- =================================================================

-- Drop and recreate the function with the fix
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION get_dates_today_for_user(UUID) TO authenticated;
