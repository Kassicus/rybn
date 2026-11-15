import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getDeveloperId } from '@/lib/auth/developer';
import { readOwnContact } from '@/lib/profile/own-contact';

/**
 * Test endpoint to verify date reminders database setup
 * GET /api/test-reminders
 *
 * Developer diagnostic. Answers only for a Clerk user id listed in
 * DEVELOPER_USER_IDS (lib/auth/developer.ts); for everyone else, signed in or
 * not, it is a 404, decided before a database client is opened.
 */
export async function GET() {
  const userId = await getDeveloperId();

  if (!userId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const supabase = await createClient();

    // The developer's own email, from own_contact(); Clerk's auth() only
    // returns ids. None when the read fails or finds no row.
    const own = await readOwnContact(supabase);
    const email = 'contact' in own ? (own.contact?.email ?? null) : null;

    // Test 1: Check if date_notifications table exists
    const { error: tableError } = await supabase
      .from('date_notifications')
      .select('id')
      .limit(1);

    // Test 2: Try calling the function
    const { data: functionResult, error: functionError } = await supabase
      .rpc('get_dates_today_for_user', { p_user_id: userId });

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        email
      },
      tests: {
        tableExists: !tableError,
        tableError: tableError ? {
          message: tableError.message,
          code: tableError.code,
          details: tableError.details,
          hint: tableError.hint
        } : null,
        functionWorks: !functionError,
        functionError: functionError ? {
          message: functionError.message,
          code: functionError.code,
          details: functionError.details,
          hint: functionError.hint
        } : null,
        functionResult: functionResult
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: 'Unexpected error',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
