import { NextRequest, NextResponse } from 'next/server';
import { checkAndSendDateReminders } from '@/lib/actions/date-reminders';

/**
 * Cron job endpoint to check for upcoming dates and send reminders.
 *
 * Driven by vercel.json ("0 9 * * *"). Vercel issues the scheduled request as
 * a GET and, when CRON_SECRET is set on the project, attaches
 * `Authorization: Bearer <CRON_SECRET>` to it. GET and POST are therefore
 * handled identically here: the schedule must work whichever verb reaches us,
 * and an endpoint that is safe under one verb and refuses under the other is
 * an outage waiting for a platform detail to change.
 *
 * THIS ROUTE IS NO LONGER THE ONLY THING STANDING BETWEEN THE INTERNET AND
 * THE SERVICE-ROLE CLIENT. checkAndSendDateReminders() verifies CRON_SECRET
 * itself, because it is an exported "use server" function and so is reachable
 * over HTTP without going through here at all. The check below is defence at
 * the edge -- it keeps an unauthorised caller from reaching application code
 * and gives them an honest 401 -- not the only defence.
 *
 * Example external cron (with curl):
 * curl -X POST https://yourdomain.com/api/cron/check-date-reminders \
 *   -H "Authorization: Bearer YOUR_CRON_SECRET"
 */
function authorize(request: NextRequest): NextResponse | null {
  const expectedToken = process.env.CRON_SECRET;

  if (!expectedToken) {
    console.error('CRON_SECRET is not configured');
    return NextResponse.json(
      { error: 'Service not properly configured' },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get('authorization');

  if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
    console.error('Unauthorized cron job attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

async function runReminders(request: NextRequest, daysAhead: number) {
  const denied = authorize(request);
  if (denied) {
    return denied;
  }

  try {
    console.log(`Starting date reminder check (${daysAhead} days ahead)...`);
    const result = await checkAndSendDateReminders(
      process.env.CRON_SECRET,
      daysAhead
    );

    console.log('Date reminder check completed:', result);

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in date reminders cron job:', error);
    return NextResponse.json(
      {
        error: 'Failed to process date reminders',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return runReminders(request, 0); // 0 = today
}

/**
 * The verb Vercel Cron actually uses. Outside production the `days` query
 * parameter shifts the window, which is how this gets tested by hand; the
 * schedule itself always means "today".
 */
export async function GET(request: NextRequest) {
  const daysAhead =
    process.env.NODE_ENV === 'production'
      ? 0
      : parseInt(request.nextUrl.searchParams.get('days') || '0');

  return runReminders(request, Number.isNaN(daysAhead) ? 0 : daysAhead);
}
