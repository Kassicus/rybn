import type { NextConfig } from "next";

// Derive the Supabase origin from the configured URL so the CSP can never
// drift from the project the app actually talks to. Hardcoding it here once
// left production pointing at a decommissioned project, which silently
// blocked every browser-side Supabase call.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";
const connectSrc = [
  "'self'",
  supabaseOrigin,
  supabaseOrigin.replace(/^https:/, "wss:"),
]
  .filter(Boolean)
  .join(" ");

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // TypeScript checking is now enabled - all errors fixed!
  typescript: {
    ignoreBuildErrors: false,
  },
  // React Compiler (requires babel-plugin-react-compiler package)
  // Uncomment after installing: npm install -D babel-plugin-react-compiler
  // reactCompiler: true,
  images: {
    // Replaced deprecated 'domains' with 'remotePatterns'
    remotePatterns: [
      // Add patterns here when using external images
      // Example: { protocol: 'https', hostname: '**.supabase.co' }
    ],
  },
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: '/:path*',
        headers: [
          // Prevent clickjacking attacks (SAMEORIGIN allows Capacitor WebView)
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          // Prevent MIME type sniffing
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          // Control referrer information
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          // Enable XSS protection (legacy browsers)
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          // Enforce HTTPS (HSTS) - 1 year max-age
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          // Permissions Policy - restrict browser features (allow camera for native app)
          {
            key: 'Permissions-Policy',
            value: 'camera=(self), microphone=(), geolocation=()',
          },
          // Content Security Policy
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // Next.js requires unsafe-eval and unsafe-inline
              "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              `connect-src ${connectSrc}`,
              "frame-ancestors 'self' capacitor: ionic:",
              "base-uri 'self'",
              "form-action 'self'",
            ].join('; '),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
