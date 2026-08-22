/**
 * API Endpoint Registry
 * Defines all API endpoints for documentation and testing
 */

export interface ApiParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object';
  required: boolean;
  description: string;
  example?: string;
}

export interface ApiEndpoint {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  description: string;
  category: string;
  requiresAuth: boolean;
  queryParams?: ApiParameter[];
  bodyParams?: ApiParameter[];
  headers?: ApiParameter[];
  exampleRequest?: any;
  exampleResponse?: any;
  notes?: string[];
}

// /api/test-email is deliberately absent, and so is /api/admin/migrate-email-preferences.
//
// The first let any signed-in user send mail from the app's verified sending
// domain to an address of their choosing, on the live Resend key -- a spam and
// domain-reputation vector wearing a diagnostic's clothes. There is no
// site-admin concept in this app to gate it behind, and inventing one for a
// mail-tester helper is not worth what it costs. Deliverability is checked from
// the Resend dashboard instead.
//
// The second was a one-shot data migration whose own docstring said to delete
// it once run. user_profiles.email_preferences and its GIN index are both in
// the schema baseline, so the endpoint could no longer do anything but report
// that its work was already done.
//
// If either comes back, it needs a gate, not a registry entry.
export const API_ENDPOINTS: ApiEndpoint[] = [
  // Database Testing
  {
    path: '/api/test-reminders',
    method: 'GET',
    description: 'Test the date reminders database setup and configuration',
    category: 'Testing',
    requiresAuth: true,
    exampleResponse: {
      success: true,
      user: {
        id: 'user-id',
        email: 'user@example.com'
      },
      tests: {
        tableExists: true,
        functionWorks: true,
        functionResult: []
      }
    },
    notes: [
      'Verifies date_notifications table exists',
      'Tests the get_dates_today_for_user database function',
      'Returns diagnostics for troubleshooting'
    ]
  },

  // Cron Jobs
  {
    path: '/api/cron/check-date-reminders',
    method: 'GET',
    description: 'Test date reminder checking (development only)',
    category: 'Cron',
    requiresAuth: false,
    queryParams: [
      {
        name: 'days',
        type: 'number',
        required: false,
        description: 'Number of days ahead to check (default: 0 for today)',
        example: '0'
      }
    ],
    exampleResponse: {
      success: true,
      usersProcessed: 5,
      emailsSent: 3,
      errors: 0,
      timestamp: '2025-01-19T12:00:00Z'
    },
    notes: [
      'Only available in development mode',
      'Use days parameter to test future dates',
      'Returns summary of reminders processed'
    ]
  },
  {
    path: '/api/cron/check-date-reminders',
    method: 'POST',
    description: 'Run the daily date reminder cron job',
    category: 'Cron',
    requiresAuth: true,
    headers: [
      {
        name: 'Authorization',
        type: 'string',
        required: true,
        description: 'Bearer token for cron job authentication (checked in every environment)',
        example: 'Bearer your-cron-secret'
      }
    ],
    exampleResponse: {
      success: true,
      usersProcessed: 10,
      emailsSent: 7,
      errors: 0,
      timestamp: '2025-01-19T12:00:00Z'
    },
    notes: [
      'Protected by CRON_SECRET, unconditionally -- not just in production',
      'Typically called by Vercel Cron or external scheduler',
      'Checks for birthdays/anniversaries happening today'
    ]
  }
];

export const API_CATEGORIES = Array.from(new Set(API_ENDPOINTS.map(e => e.category)));
