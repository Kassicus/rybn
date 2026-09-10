# Rybn - Tied Together

Gift giving, beautifully wrapped. A full-stack gift coordination app built with Next.js, Clerk, Supabase, and Monday.com's Vibe design system.

**Domain**: rybn.app

## What's built

- Next.js 16 with TypeScript and the App Router
- Clerk authentication (email/password and Google), with route protection in
  `proxy.ts` and lazy profile provisioning on first authenticated request
- Supabase for data and private image storage, with row-level security doing
  the real access control (see `supabase/tests/rls/`)
- Groups and invitations, with family/friends/work/custom types
- Profiles with per-field visibility -- sizes, preferences, vehicles, personal
  details and important dates, each restrictable by group or group type
- Wishlists, including auto-fill from a pasted product URL
- Group gifts with their own chat, hidden from the recipient
- Gift exchanges (secret-santa style draws)
- A gift tracker for what you have already bought
- Transactional email via Resend, and date reminders on a cron

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account (for the database and realtime)
- Clerk account (for authentication)
- Resend account (for email)

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Copy `.env.example` to `.env.local` and fill in your credentials:
   ```bash
   cp .env.example .env.local
   ```

4. Run the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000)

## Production configuration

Production runs on a Clerk **production** instance. Development and preview run
on the development instance. Vercel holds two entries per key, scoped so they
do not overlap:

| Variable | Production | Preview + Development |
| --- | --- | --- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | `pk_live_...` | `pk_test_...` |
| `CLERK_SECRET_KEY` | `sk_live_...` | `sk_test_...` |

Clerk's production instance is configured for the domain `rybn.app`, serving
its Frontend API from `clerk.rybn.app` and the account portal from
`accounts.rybn.app`. DNS for those lives at Namecheap, not Vercel.

Three things here are not obvious and each one cost real time:

**Supabase trusts exactly one Clerk issuer, and it is set in the dashboard.**
Authentication -> Sign In / Providers -> Third Party Auth. The
`[auth.third_party.clerk]` block in `supabase/config.toml` looks like it
controls this. It does not -- the CLI neither diffs nor pushes third-party
auth, so `config push` will report "nothing to push" while the two disagree.
Keep the file in step with the dashboard as documentation, and change the
dashboard when you mean it.

**Getting that wrong fails silently.** Every RLS policy is `TO authenticated`,
so a token from an untrusted issuer matches no policy and returns zero rows
with no error. The symptom is a user who signs in perfectly and lands on an
empty dashboard. Nothing logs a cause. Writes fail the same way, rejected as
"not found" rather than "forbidden".

**The app must be served from the apex.** Clerk scopes its session cookie to
the domain configured above. `rybn.app` is the primary domain in Vercel and
`www.rybn.app` redirects to it. Reverse that and sessions stop reaching the
app: sign-in appears to succeed, then `/dashboard` bounces to `/login`, which
renders blank because Clerk's `<SignIn/>` shows nothing to an already
signed-in user.

### Checks

```bash
npm run type-check   # tsc --noEmit
npm test             # Vitest unit tests
npm run test:rls     # RLS policy suite, runs against the linked project
npm run lint         # ESLint (flat config; `next lint` was removed in Next 16)
npm run build
```

## Tech Stack

- **Next.js 16** - React framework with App Router
- **TypeScript** - Type safety
- **Clerk** - Authentication
- **Supabase** - Database and real-time
- **Resend** - Email notifications
- **Monday.com Vibe** - Design system and components
- **React Hook Form** - Form management
- **Zod** - Schema validation
- **TanStack Query** - Server state management
- **next-themes** - installed, but not currently wired up: `RybnThemeProvider`
  is never mounted and `ThemeToggle` is never rendered, so there is no dark mode
- **Tailwind CSS** - Styling

## Project Structure

```
rybn/
├── app/                        # Next.js app router
│   ├── (auth)/                # Authentication pages
│   │   ├── login/[[...rest]]/ # Clerk <SignIn/> (catch-all: Clerk routes its
│   │   │                      #   own sub-steps under this path)
│   │   ├── register/[[...rest]]/ # Clerk <SignUp/> (catch-all, same reason)
│   │   └── accept-invite/     # Invitation acceptance (hash-routed <SignUp/>)
│   ├── (dashboard)/           # Signed-in pages (layout redirect + proxy.ts)
│   ├── (legal)/               # Public /privacy and /terms
│   └── api/                   # API routes
├── components/                # React components
│   └── vibe/                  # Vibe component wrappers
├── lib/                       # Utilities and clients
│   ├── auth/                 # requireAuth + profile provisioning
│   ├── actions/              # Server actions
│   ├── supabase/             # Supabase clients (Clerk-authenticated)
│   ├── resend/               # Email templates
│   └── hooks/                # Custom React hooks
├── hooks/                    # Client hooks (useSearch, useHydrated)
├── proxy.ts                  # clerkMiddleware + protected-route matcher
├── types/                    # TypeScript types
└── _planning/                # Project documentation
```

## What's next

A UI/UX overhaul is the current focus. The feature surface above is largely in
place; the interface is what needs work.

Known outstanding items:

- `next-themes` is installed but unwired, so there is no dark mode (see Tech
  Stack above)
- ~66 ESLint findings remain, mostly `@typescript-eslint/no-explicit-any`,
  plus five `<img>` tags that should become `next/image`
- `getPrivacyDescription()` in `lib/utils/privacy.ts` ignores per-group
  overrides, so the summary it renders can understate how restricted a field is

`_planning/` holds the original phase plan and the design and implementation
documents for the Clerk migration and link-metadata work.

## License

MIT
