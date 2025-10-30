# Date Reminders Feature Documentation

## Overview

The Date Reminders feature sends automatic email notifications and displays in-app banners to group members when someone in their group has a birthday or anniversary coming up. This feature respects the privacy settings configured by each user.

## Features

✅ **Email Notifications** - Sent to all group members who can view the date based on privacy settings
✅ **In-App Banners** - Displayed on the dashboard for dates happening today
✅ **Privacy-Aware** - Respects existing privacy controls on date fields
✅ **Multi-Group Support** - Sends separate notifications for each group context
✅ **Dismissible Banners** - Users can dismiss banners for dates they've acknowledged
✅ **Duplicate Prevention** - Ensures users are only notified once per year per date

## Architecture

### Database Schema

**New Table: `date_notifications`**
- Tracks which users have been notified about which dates
- Prevents duplicate notifications
- Tracks banner display and dismissal state
- Links notifications to specific group contexts

**New Functions:**
- `get_upcoming_dates_for_notifications(days_ahead, target_year)` - Finds dates that need notifications
- `get_dates_today_for_user(user_id)` - Retrieves active banners for a user
- `can_view_field()` - Existing function used to check privacy permissions

### Components

**Email Template:** `lib/resend/templates/DateReminderEmail.tsx`
- Professional, responsive email design
- Links to celebrant's wishlist and profile
- Shows group context and date type

**Banner Component:** `components/reminders/DateReminderBanner.tsx`
- Client-side component with dismiss functionality
- Displays multiple reminders if needed
- Color-coded with birthday/anniversary icons
- Quick links to wishlist and profile

### Server Actions

**File:** `lib/actions/date-reminders.ts`

Functions:
- `checkAndSendDateReminders(daysAhead)` - Main function to process reminders
- `getActiveDateReminders()` - Fetch active banners for current user
- `dismissDateReminder(notificationId)` - Dismiss a banner
- `manualTriggerReminders(daysAhead)` - Development testing function

### API Routes

**Cron Job Endpoint:** `app/api/cron/check-date-reminders/route.ts`

- **POST** - Secured endpoint for scheduled jobs
- **GET** - Development-only testing endpoint
- Protected by `CRON_SECRET` environment variable in production

## Installation & Setup

### 1. Run Database Migration

Apply the migration to create the necessary tables and functions:

```bash
# If using Supabase CLI
supabase db push

# Or apply the migration file directly through Supabase Dashboard
# Location: supabase/migrations/20250201000000_create_date_reminders.sql
```

### 2. Configure Environment Variables

Add to your `.env.local`:

```env
# Generate a secure secret for cron job authentication
# Use: openssl rand -base64 32
CRON_SECRET=your-generated-secret-here
```

### 3. Set Up Cron Job (Production)

#### Option A: Vercel Cron (Recommended)

The `vercel.json` file is already configured:

```json
{
  "crons": [{
    "path": "/api/cron/check-date-reminders",
    "schedule": "0 9 * * *"
  }]
}
```

This runs daily at 9:00 AM UTC. Adjust the schedule as needed using cron syntax.

**Important:** Add `CRON_SECRET` to your Vercel environment variables:
1. Go to your Vercel project settings
2. Navigate to Environment Variables
3. Add `CRON_SECRET` with your generated secret

#### Option B: External Cron Service

Use any cron service (GitHub Actions, cron-job.org, etc.):

```bash
curl -X POST https://yourdomain.com/api/cron/check-date-reminders \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

### 4. Test the Feature

#### Development Testing

Test the reminder system without waiting for scheduled cron:

```bash
# Test reminders for today (0 days ahead)
curl http://localhost:3000/api/cron/check-date-reminders?days=0

# Test reminders for tomorrow (1 day ahead)
curl http://localhost:3000/api/cron/check-date-reminders?days=1

# Test reminders for next week (7 days ahead)
curl http://localhost:3000/api/cron/check-date-reminders?days=7
```

**Note:** GET method only works in development mode for security.

#### Manual Trigger (Server Action)

You can also trigger reminders programmatically:

```typescript
import { manualTriggerReminders } from '@/lib/actions/date-reminders';

// Only works in development
const result = await manualTriggerReminders(1); // 1 day ahead
console.log(result);
```

## How It Works

### 1. User Sets Birthday/Anniversary

Users configure their birthday and anniversary in their profile settings under the "Dates" section. They can set privacy controls to determine which groups can see these dates.

**Privacy Options:**
- Private - No one can see
- Group - All group members can see
- Friends - Only friends groups can see
- Family - Only family groups can see
- Public - Everyone can see
- Custom overrides per group

### 2. Daily Cron Job Runs

Every day at the scheduled time (default 9 AM UTC), the cron job:

1. Queries `get_upcoming_dates_for_notifications()`
2. Finds all dates happening today (or within configured days ahead)
3. Checks privacy settings via `can_view_field()`
4. Filters out dates already notified this year
5. Creates `date_notifications` records
6. Sends email notifications
7. Returns summary of sent notifications

### 3. Email Sent

Each group member who can view the date receives an email with:
- Celebrant's name
- Date type (birthday/anniversary)
- Celebration date (month and day)
- Group context
- Links to wishlist and profile
- Dismissible action

### 4. Banner Displayed

When users log in on the celebration day:
1. Dashboard layout fetches active reminders via `getActiveDateReminders()`
2. `DateReminderBanner` component renders
3. Shows all non-dismissed reminders
4. Users can dismiss individual reminders
5. Dismissed state persists in database

## Privacy & Security

### Privacy Controls

The feature fully respects existing privacy settings:
- Uses the `can_view_field()` function from the profile system
- Checks both default privacy level and group-specific overrides
- Only notifies users who have permission to view the date

### Security Measures

**Cron Endpoint Protection:**
- Production endpoints require `CRON_SECRET` in Authorization header
- Development mode allows GET for testing
- Invalid tokens return 401 Unauthorized

**Row-Level Security (RLS):**
- `date_notifications` table has RLS enabled
- Users can only view their own notifications
- Users can only update their own notifications (for dismissing)
- System/service role can insert notifications

### Data Privacy

- Notifications are scoped to specific groups
- Each notification links to a group context
- Users only see notifications for groups they're in
- Celebrant's dates are only visible based on their privacy settings

## Customization

### Adjust Notification Timing

**Send reminders 1 day before:**
```typescript
// In app/api/cron/check-date-reminders/route.ts
const result = await checkAndSendDateReminders(1); // 1 day ahead
```

**Change cron schedule:**
```json
// In vercel.json
{
  "crons": [{
    "path": "/api/cron/check-date-reminders",
    "schedule": "0 8 * * *"  // 8 AM instead of 9 AM
  }]
}
```

### Customize Email Template

Edit `lib/resend/templates/DateReminderEmail.tsx`:
- Update colors
- Change emoji icons
- Modify email copy
- Add additional links or sections

### Customize Banner Appearance

Edit `components/reminders/DateReminderBanner.tsx`:
- Update styling (colors, borders, shadows)
- Change icons
- Modify layout
- Add additional actions

## Database Schema Details

### date_notifications Table

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| notified_user_id | UUID | User receiving notification |
| celebrant_id | UUID | User celebrating the date |
| field_name | TEXT | 'birthday' or 'anniversary' |
| group_id | UUID | Group context for notification |
| celebration_date | DATE | Full date with year |
| notification_year | INTEGER | Year notification was sent |
| email_sent | BOOLEAN | Whether email was delivered |
| email_sent_at | TIMESTAMPTZ | Email delivery timestamp |
| banner_shown | BOOLEAN | Whether to show banner |
| banner_dismissed | BOOLEAN | Whether user dismissed banner |
| banner_dismissed_at | TIMESTAMPTZ | Dismissal timestamp |
| created_at | TIMESTAMPTZ | Record creation time |
| updated_at | TIMESTAMPTZ | Last update time |

**Unique Constraint:** (notified_user_id, celebrant_id, field_name, notification_year, group_id)
- Prevents duplicate notifications for the same user/date/year/group combination

## Troubleshooting

### Notifications Not Sending

1. **Check cron job is running:**
   - Verify in Vercel dashboard under "Cron Jobs"
   - Check logs for execution history

2. **Verify CRON_SECRET is set:**
   - Ensure environment variable exists
   - Confirm it matches between caller and API

3. **Check date privacy settings:**
   - Ensure dates have appropriate privacy levels
   - Verify group memberships exist

4. **Review Resend API:**
   - Check Resend dashboard for email delivery status
   - Verify RESEND_API_KEY is valid
   - Check email sending limits

### Banners Not Appearing

1. **Check notifications exist:**
   ```sql
   SELECT * FROM date_notifications
   WHERE notified_user_id = 'user-uuid'
   AND notification_year = 2025
   AND celebration_date = CURRENT_DATE;
   ```

2. **Verify banner not dismissed:**
   - Check `banner_dismissed` column
   - Ensure `banner_shown` is true

3. **Check function permissions:**
   ```sql
   SELECT * FROM get_dates_today_for_user('user-uuid');
   ```

### Testing Issues

1. **Can't test in production:**
   - GET endpoint is disabled in production
   - Use POST with Authorization header

2. **No dates found:**
   - Ensure test dates are set correctly
   - Use future dates or adjust system date
   - Check privacy settings allow viewing

## Future Enhancements

Potential improvements for future versions:

- [ ] Support for custom date types (graduations, holidays, etc.)
- [ ] Configurable notification timing per user
- [ ] Reminder preferences (email only, banner only, both)
- [ ] Weekly digest of upcoming dates
- [ ] Gift suggestions based on profile info
- [ ] Group coordination for joint gifts
- [ ] SMS notifications via Twilio
- [ ] Push notifications for mobile apps
- [ ] Recurring reminder snooze options
- [ ] Calendar export (iCal format)

## API Reference

### checkAndSendDateReminders(daysAhead)

**Server Action** - Checks for dates and sends notifications

**Parameters:**
- `daysAhead` (number, default: 1) - How many days ahead to check

**Returns:**
```typescript
{
  sent: number;           // Number of emails sent
  total: number;          // Total reminders processed
  errors?: Array<{        // Optional array of errors
    email: string;
    error: string;
  }>;
}
```

### getActiveDateReminders()

**Server Action** - Gets active reminders for current user

**Returns:**
```typescript
{
  data: Array<{
    celebrant_id: string;
    celebrant_username: string;
    celebrant_display_name: string | null;
    field_name: string;
    celebration_date: string;
    group_id: string;
    group_name: string;
    group_type: string;
    notification_id: string;
    banner_dismissed: boolean;
  }>;
  error?: string;
}
```

### dismissDateReminder(notificationId)

**Server Action** - Dismiss a date reminder banner

**Parameters:**
- `notificationId` (string) - UUID of notification to dismiss

**Returns:**
```typescript
{
  success?: boolean;
  error?: string;
}
```

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review server logs for detailed error messages
3. Consult Supabase and Resend documentation
4. Check database RLS policies and permissions

## License

Part of the Rybn project - see main README for license details.
