import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * TEMPORARY MIGRATION ENDPOINT
 * This adds the email_preferences column to user_profiles table
 *
 * To run: Visit /api/admin/migrate-email-preferences in your browser while logged in
 * After running once successfully, you can delete this file.
 */
export async function GET() {
  try {
    const supabase = await createClient();

    // Check authentication
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Not authenticated. Please log in first.' },
        { status: 401 }
      );
    }

    // Check if column already exists by trying to select it
    const { error: checkError } = await supabase
      .from('user_profiles')
      .select('email_preferences')
      .limit(1);

    if (!checkError) {
      return NextResponse.json({
        success: true,
        message: 'Migration already complete! The email_preferences column already exists.',
        alreadyExists: true
      });
    }

    // If column doesn't exist, we need to show instructions for manual migration
    // because Supabase client can't execute DDL statements
    const migrationSQL = `-- Add email_preferences column to user_profiles table
ALTER TABLE user_profiles
ADD COLUMN IF NOT EXISTS email_preferences JSONB DEFAULT '{
  "email_group_invites": true,
  "email_date_reminders": true,
  "email_gift_updates": true,
  "email_exchange_notifications": true,
  "email_marketing": false
}'::jsonb;

-- Add a comment to document the column
COMMENT ON COLUMN user_profiles.email_preferences IS 'User email notification preferences in JSONB format';

-- Create an index for faster JSON queries on email preferences
CREATE INDEX IF NOT EXISTS idx_user_profiles_email_preferences
ON user_profiles USING GIN (email_preferences);`;

    return NextResponse.json({
      success: false,
      message: 'Migration needed. The Supabase client cannot run DDL statements.',
      instructions: [
        '1. Try the Supabase Dashboard again at https://supabase.com/dashboard',
        '2. Go to SQL Editor',
        '3. Click "New Query"',
        '4. Paste the SQL provided below',
        '5. Click Run',
        '',
        'If the dashboard still doesn\'t work:',
        '- Try a different browser',
        '- Clear your browser cache',
        '- Try incognito/private mode'
      ],
      sql: migrationSQL,
      alternativeMethod: 'You can also run this SQL using any PostgreSQL client connected to your Supabase database'
    });

  } catch (error) {
    console.error('Migration check error:', error);
    return NextResponse.json(
      {
        error: 'Failed to check migration status',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
