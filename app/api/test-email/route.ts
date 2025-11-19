import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { sendTestEmail } from '@/lib/resend/send';
import { EMAIL_FROM, EMAIL_FROM_NAME } from '@/lib/resend/client';

/**
 * Test endpoint to send emails to mail-tester.com for deliverability testing
 *
 * Usage:
 * 1. Visit https://www.mail-tester.com/ and get your test email address
 * 2. POST to this endpoint with { "email": "test-xxxxx@mail-tester.com" }
 * 3. Check your score on mail-tester.com
 *
 * POST /api/test-email
 * Body: { "email": "test-xxxxx@mail-tester.com" }
 */
export async function POST(request: NextRequest) {
  try {
    // Authenticate the user
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json(
        { error: "Not authenticated. Please log in to send test emails." },
        { status: 401 }
      );
    }

    // Parse request body
    const body = await request.json();
    const { email } = body;

    if (!email) {
      return NextResponse.json(
        { error: "Email address is required. Please provide a mail-tester.com email address." },
        { status: 400 }
      );
    }

    // Basic email validation
    if (!email.includes('@')) {
      return NextResponse.json(
        { error: "Invalid email address format." },
        { status: 400 }
      );
    }

    // Send the test email with all deliverability features
    const result = await sendTestEmail(email);

    return NextResponse.json({
      success: true,
      message: "Test email sent successfully! Check mail-tester.com for your score.",
      details: {
        emailId: result.data?.id,
        sentTo: email,
        from: `${EMAIL_FROM_NAME} <${EMAIL_FROM}>`,
        timestamp: new Date().toISOString(),
      },
      instructions: [
        "1. Go back to mail-tester.com",
        "2. Click 'Then check your score'",
        "3. Review your deliverability score (aim for 8+/10)",
        "4. Check for SPF, DKIM, and DMARC authentication passes"
      ]
    });
  } catch (error) {
    console.error('Error sending test email:', error);
    return NextResponse.json(
      {
        error: 'Failed to send test email',
        details: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint to provide instructions for using the test email feature
 */
export async function GET() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://rybn.app';

  return NextResponse.json({
    endpoint: '/api/test-email',
    description: 'Send test emails to mail-tester.com to check email deliverability',
    method: 'POST',
    authentication: 'Required (must be logged in)',
    requestBody: {
      email: 'test-xxxxx@mail-tester.com (get this from mail-tester.com)'
    },
    usage: [
      '1. Visit https://www.mail-tester.com/',
      '2. Copy the test email address provided',
      '3. POST to this endpoint with { "email": "<the-test-address>" }',
      '4. Go back to mail-tester.com and click "Then check your score"',
      '5. Review your deliverability score and recommendations'
    ],
    exampleCurl: `curl -X POST ${appUrl}/api/test-email \\
  -H "Content-Type: application/json" \\
  -d '{"email":"test-xxxxx@mail-tester.com"}'`,
    features: [
      'HTML and plain text versions',
      'SPF authentication',
      'DKIM signatures',
      'DMARC policy compliance',
      'Reply-To headers',
      'List-Unsubscribe headers',
      'Proper sender configuration'
    ]
  });
}
