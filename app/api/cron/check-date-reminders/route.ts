import { NextRequest, NextResponse } from 'next/server';
import { checkAndSendDateReminders } from '@/lib/actions/date-reminders';

/**
 * Cron job endpoint to check for upcoming dates and send reminders
 *
 * This endpoint should be called daily by a cron service (e.g., Vercel Cron, GitHub Actions, etc.)
 *
 * Security:
 * - In production, this should be protected by a secret token
 * - The token should be passed in the Authorization header
 *
 * Example Vercel Cron configuration in vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/check-date-reminders",
 *     "schedule": "0 9 * * *"  // Run daily at 9 AM
 *   }]
 * }
 *
 * Example external cron (with curl):
 * curl -X POST https://yourdomain.com/api/cron/check-date-reminders \
 *   -H "Authorization: Bearer YOUR_CRON_SECRET"
 */
export async function POST(request: NextRequest) {
  try {
    // Verify authorization in production
    if (process.env.NODE_ENV === 'production') {
      const authHeader = request.headers.get('authorization');
      const expectedToken = process.env.CRON_SECRET;

      if (!expectedToken) {
        console.error('CRON_SECRET is not configured');
        return NextResponse.json(
          { error: 'Service not properly configured' },
          { status: 500 }
        );
      }

      if (!authHeader || authHeader !== `Bearer ${expectedToken}`) {
        console.error('Unauthorized cron job attempt');
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401 }
        );
      }
    }

    // Check for dates happening today
    console.log('Starting date reminder check...');
    const result = await checkAndSendDateReminders(0); // 0 = today

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

/**
 * GET endpoint for manual testing in development
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json(
      { error: 'GET method not allowed in production' },
      { status: 405 }
    );
  }

  try {
    const daysAhead = parseInt(request.nextUrl.searchParams.get('days') || '0');

    console.log(`Testing date reminders (${daysAhead} days ahead)...`);
    const result = await checkAndSendDateReminders(daysAhead);

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Error in date reminders test:', error);
    return NextResponse.json(
      {
        error: 'Failed to test date reminders',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
