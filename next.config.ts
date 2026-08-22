import type { NextConfig } from "next";

// Derive the Supabase origin from the configured URL so the CSP can never
// drift from the project the app actually talks to. Hardcoding it here once
// left production pointing at a decommissioned project, which silently
// blocked every browser-side Supabase call.
const supabaseOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin
  : "";
// Clerk serves clerk-js, and answers its Frontend API calls, from the instance's
// own host. That host is encoded in the publishable key -- pk_<env>_<base64 of
// "host$"> -- which is how Clerk's own SDK resolves it, so deriving it here
// keeps the CSP pointed at whichever instance the app is actually configured
// against (a *.clerk.accounts.dev instance locally, clerk.rybn.app in
// production) instead of a hardcoded host that can go stale.
const clerkOrigin = (() => {
  const encoded = (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "")
    .trim()
    .replace(/^pk_(test|live)_/, "");
  if (!encoded) return "";
  const host = Buffer.from(encoded, "base64").toString("utf8").replace(/\$$/, "");
  return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(host) ? `https://${host}` : "";
})();

// Clerk's telemetry endpoint is a fixed origin, separate from the instance host.
const clerkTelemetry = "https://clerk-telemetry.com";
// Clerk's bot protection renders a Cloudflare Turnstile widget in an iframe and
// loads its script from Cloudflare, not from the Clerk instance host.
const cloudflareChallenges = "https://challenges.cloudflare.com";

const connectSrc = [
  "'self'",
  supabaseOrigin,
  supabaseOrigin.replace(/^https:/, "wss:"),
  clerkOrigin,
  clerkTelemetry,
]
  .filter(Boolean)
  .join(" ");

const scriptSrc = [
  "'self'",
  // Next.js requires unsafe-eval and unsafe-inline
  "'unsafe-eval'",
  "'unsafe-inline'",
  clerkOrigin,
  cloudflareChallenges,
]
  .filter(Boolean)
  .join(" ");

const frameSrc = ["'self'", clerkOrigin, cloudflareChallenges]
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
          // Prevent clickjacking attacks
          {
            key: 'X-Frame-Options',
            value: 'DENY',
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
          // Permissions Policy - deny camera, microphone and geolocation
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
          // Content Security Policy
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              `script-src ${scriptSrc}`,
              "style-src 'self' 'unsafe-inline'", // Tailwind requires unsafe-inline
              // Clerk's user avatars (img.clerk.com) are already covered by the
              // blanket https: source below; keep that in mind before tightening it.
              "img-src 'self' data: https:",
              "font-src 'self' data:",
              `connect-src ${connectSrc}`,
              // clerk-js instantiates a Web Worker from a blob URL for session
              // token refresh, which default-src 'self' alone rejects.
              "worker-src 'self' blob:",
              `frame-src ${frameSrc}`,
              "frame-ancestors 'none'",
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
