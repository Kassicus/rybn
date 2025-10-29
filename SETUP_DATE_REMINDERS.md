# Quick Setup: Date Reminders Feature

This guide will help you set up the date reminders feature locally.

## Prerequisites

You need access to your Supabase project's SQL Editor or have the Supabase CLI installed.

## Option 1: Using Supabase Dashboard (Easiest)

1. **Go to your Supabase project dashboard**
   - Navigate to https://app.supabase.com
   - Select your project

2. **Open the SQL Editor**
   - Click on "SQL Editor" in the left sidebar
   - Click "New query"

3. **Copy and paste the migration**
   - Open the file: `supabase/migrations/20250201000000_create_date_reminders.sql`
   - Copy the entire contents
   - Paste into the SQL Editor

4. **Run the migration**
   - Click "Run" or press `Ctrl+Enter` (Windows/Linux) or `Cmd+Enter` (Mac)
   - You should see "Success. No rows returned"

5. **Verify it worked**
   - Refresh your local development server
   - The error should be gone!

## Option 2: Using Supabase CLI

If you have the Supabase CLI installed:

```bash
# Make sure you're logged in
supabase login

# Link to your project (if not already linked)
supabase link --project-ref your-project-ref

# Push the migration
supabase db push
```

## Option 3: Manual SQL Execution

If you prefer to run the SQL directly:

```bash
# Using psql (if you have database credentials)
psql "postgresql://postgres:[YOUR-PASSWORD]@[YOUR-HOST]:5432/postgres" \
  -f supabase/migrations/20250201000000_create_date_reminders.sql
```

## What Gets Created

The migration creates:

- ✅ `date_notifications` table - Stores notification records
- ✅ `get_upcoming_dates_for_notifications()` - Function to find dates needing reminders
- ✅ `get_dates_today_for_user()` - Function to get active banners
- ✅ Row-Level Security policies - Protects user data
- ✅ Indexes - For efficient queries

## Troubleshooting

### Error: "function get_dates_today_for_user does not exist"

**Solution:** The migration hasn't been run yet. Follow Option 1 above.

### Error: "relation date_notifications does not exist"

**Solution:** The migration hasn't been run yet. Follow Option 1 above.

### Error: "must be owner of function can_view_field"

**Solution:** This means the `can_view_field` function exists but you need to run the migration as the database owner. Use the Supabase Dashboard (Option 1) which runs queries with the correct permissions.

### Migration already exists error

**Solution:** If you get an error that objects already exist, the migration has already been run. You can safely ignore this.

## Next Steps

After running the migration:

1. **Set up environment variable** (optional for local development):
   ```bash
   # Add to .env.local
   CRON_SECRET=your-secret-token-here
   ```

   Generate a secret token:
   ```bash
   openssl rand -base64 32
   ```

2. **Test the feature**:
   - Add a birthday or anniversary to your profile
   - Set it to today's date or a future date
   - Test the cron endpoint:
     ```bash
     curl http://localhost:3000/api/cron/check-date-reminders?days=0
     ```

3. **Check for banners**:
   - If a date is today, you should see a banner on your dashboard
   - The banner will show for all group members who can view the date based on privacy settings

## Production Deployment

For production (Vercel):

1. Push your code to your repository
2. Vercel will automatically deploy
3. Add `CRON_SECRET` to Vercel environment variables
4. The cron job will run daily at 9 AM UTC (configured in `vercel.json`)

## Need Help?

- Check the full documentation: `DATE_REMINDERS_FEATURE.md`
- Review the migration file: `supabase/migrations/20250201000000_create_date_reminders.sql`
- Check Supabase logs for detailed error messages
