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

export const API_ENDPOINTS: ApiEndpoint[] = [
  // Email Testing
  {
    path: '/api/test-email',
    method: 'GET',
    description: 'Get information about the test email endpoint',
    category: 'Email',
    requiresAuth: false,
    exampleResponse: {
      endpoint: '/api/test-email',
      description: 'Send test emails to mail-tester.com',
      method: 'POST',
      features: ['HTML and plain text versions', 'SPF authentication', 'DKIM signatures']
    }
  },
  {
    path: '/api/test-email',
    method: 'POST',
    description: 'Send a test email to mail-tester.com for deliverability testing',
    category: 'Email',
    requiresAuth: true,
    bodyParams: [
      {
        name: 'email',
        type: 'string',
        required: true,
        description: 'Email address from mail-tester.com',
        example: 'test-xxxxx@mail-tester.com'
      }
    ],
    exampleRequest: {
      email: 'test-xxxxx@mail-tester.com'
    },
    exampleResponse: {
      success: true,
      message: 'Test email sent successfully!',
      details: {
        emailId: 'abc123',
        sentTo: 'test-xxxxx@mail-tester.com',
        timestamp: '2025-01-19T12:00:00Z'
      }
    },
    notes: [
      'Get a test email address from https://www.mail-tester.com/',
      'After sending, check your score on mail-tester.com',
      'Aim for a score of 8+/10'
    ]
  },

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
        description: 'Bearer token for cron job authentication (production only)',
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
      'Protected by CRON_SECRET in production',
      'Typically called by Vercel Cron or external scheduler',
      'Checks for birthdays/anniversaries happening today'
    ]
  }
];

export const API_CATEGORIES = Array.from(new Set(API_ENDPOINTS.map(e => e.category)));
