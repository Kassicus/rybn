# Rybn - Tied Together

Gift giving, beautifully wrapped. A full-stack gift coordination app built with Next.js, Clerk, Supabase, and Monday.com's Vibe design system.

**Domain**: rybn.app

## What's Complete (Phase 1)

**Foundation & Authentication ✓**

- Next.js 16 with TypeScript and App Router
- Monday.com Vibe design system with theme support (light/dark mode)
- Clerk authentication (login, register, Google OAuth)
- Protected routes with middleware
- Resend email integration with templates
- Basic dashboard layout with navigation

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

## Production cutover: moving Clerk from development to production

**This has not been done. The app is wired to a Clerk _development_
instance — `smiling-peacock-9097.clerk.accounts.dev` — in every
environment, production included.**

### Read this first: how it fails

Supabase trusts exactly one Clerk issuer, and the domain of that issuer is
hardcoded in `supabase/config.toml` under `[auth.third_party.clerk]`. Stand
up a production Clerk instance without updating it — or update it and forget
the `role` claim below — and Supabase stops recognising the token.

It does not raise. It does not 401. Every one of the 59 row-level security
policies in `supabase/migrations/20260821000000_clerk_native_baseline.sql`
is `TO authenticated`, so a request carrying a token from an issuer Supabase
does not trust simply never reaches the `authenticated` role, matches no
policy, and **returns zero rows with no error**.

What you will see: users sign in successfully, land on `/dashboard`, and
find an app with no groups, no wishlists, no messages and no errors. It
looks like an empty database. Writes fail the same silent way — the insert
matches no `with check` and is rejected as "not found" rather than
"forbidden". Nothing in the logs says "wrong issuer", because from
Postgres's point of view nothing went wrong.

This same symptom can also happen mid-migration without any step being
skipped, purely from timing. `supabase/config.toml` holds one issuer, so
pushing it (step 7) flips Supabase's trust the instant the push lands — but
the Vercel Production environment variables set earlier (step 2) do nothing
in the running app until Production is redeployed (step 8). Do steps 2, 7
and 8 close together in one sitting: the gap between the issuer switch and
the next redeploy is a live production outage of exactly this kind, and
nothing will tell you it's happening.

Every step below is required. Skipping any one of them produces that same
symptom, which is why the verification at the end is a real browser
walkthrough and not a health check.

### The steps, in order

1. **Create the production Clerk instance.** In the Clerk Dashboard, use the
   environment switcher to create Production for this application. It is a
   *separate instance*: it shares no configuration with Development. Every
   setting configured by hand during the migration has to be configured
   again, which is what steps 4, 5 and 6 are.

2. **Put the required environment variables in Vercel Production.** The
   production instance issues `pk_live_…` / `sk_live_…`; the development
   instance's `pk_test_…` / `sk_test_…` must not reach the Production
   environment. Beyond the two Clerk keys, Production also needs the rest of
   what `.env.example` documents:

   - `NEXT_PUBLIC_CLERK_SIGN_IN_URL`, `NEXT_PUBLIC_CLERK_SIGN_UP_URL`,
     `NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL`,
     `NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL` — without
     `NEXT_PUBLIC_CLERK_SIGN_IN_URL` in particular, `clerkMiddleware` sends
     protected routes to Clerk's hosted portal instead of this app's
     `/login`. `.env.example` documents this too.
   - `CRON_SECRET` — both the cron route and the server action it calls
     check this; without it in Production, the daily reminder job refuses
     to run (fails closed, not silently).

   ```bash
   npx vercel@latest env add NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY production
   npx vercel@latest env add CLERK_SECRET_KEY production
   npx vercel@latest env add NEXT_PUBLIC_CLERK_SIGN_IN_URL production
   npx vercel@latest env add NEXT_PUBLIC_CLERK_SIGN_UP_URL production
   npx vercel@latest env add NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL production
   npx vercel@latest env add NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL production
   npx vercel@latest env add CRON_SECRET production
   npx vercel@latest env ls production
   ```

   **These do nothing until Production is redeployed (step 8).** Vercel
   environment variables are baked in at build/deploy time, not read live —
   see the note in step 7 and the redeploy in step 8. Treat this step and
   steps 7–8 as one operation done close together, not three independent
   checklist items.

   The Content-Security-Policy needs no change: `next.config.ts` decodes the
   Clerk Frontend API host out of the publishable key at build time, so it
   follows `pk_live` automatically — and throws rather than emitting a policy
   with a hole in it if the key is missing. Confirm the deployed policy names
   the production host, not `*.clerk.accounts.dev`:

   ```bash
   curl -sI https://www.rybn.app/login | tr ';' '\n' | grep -iE "connect-src|script-src"
   ```

3. **Configure DNS.** A production Clerk instance is served from your own
   domain, not `*.clerk.accounts.dev`. Clerk's dashboard lists the CNAME
   records to add for `rybn.app` (`clerk`, `accounts`, and the mail records
   for `clkmail`/DKIM). Add them where rybn.app's DNS lives and wait for
   Clerk to report them verified before continuing — the instance does not
   serve traffic until it has a certificate.

4. **Re-add the `role: "authenticated"` session-token claim.** Clerk
   Dashboard → **Sessions** → **Customize session token**:

   ```json
   { "role": "authenticated" }
   ```

   This was added by hand on the development instance and is *per instance*,
   so the production instance starts without it. Supabase maps the token to
   the `authenticated` Postgres role from this claim, and every policy in the
   schema is `TO authenticated`. Without it: the empty-app symptom above,
   with a perfectly valid Clerk session. This is the single easiest step to
   forget and the hardest to diagnose after the fact.

5. **Enable and require username.** Clerk Dashboard → **User & Authentication**
   → **Email, Phone, Username** → turn on **Username** and set it
   **Required**. This is exactly as per-instance as the `role` claim above
   and the OAuth client below: it was set by hand on the development
   instance, and the production instance starts without it.

   Unlike the other steps here, forgetting this one degrades rather than
   fails: `sanitizeUsername(null, userId)` (`lib/auth/username.ts`) falls
   back to generating `user_xxxxxxxx` for anyone Clerk hands back without a
   username, and the user can change it later at `/profile/edit`. So this is
   not a cutover blocker — but it belongs on this list, not discovered later
   as oddly-named accounts.

6. **Create a production Google OAuth client.** The development instance uses
   Clerk's shared pre-configured Google credentials; production instances
   cannot, and Google sign-in is one of only two sign-in methods this app
   offers. In Google Cloud Console create an OAuth 2.0 Client ID for
   rybn.app, then in Clerk Dashboard → **User & Authentication** → **Social
   Connections** → **Google**, switch off "Use shared credentials" and paste
   the client ID and secret, using the Authorized redirect URI Clerk shows on
   that screen.

7. **Point Supabase at the new issuer.** Update the domain in
   `supabase/config.toml` to the production Clerk Frontend API host (the one
   from step 3, e.g. `clerk.rybn.app`) and push it:

   ```bash
   npx supabase@latest config push --linked
   ```

   The CLI validates this value whenever the block is `enabled`, and a
   *syntactically valid but wrong* domain passes validation and quietly
   registers a bogus issuer. Change it once, deliberately. Note that the
   whole Supabase CLI — including `npm run test:rls` — fails while this value
   is invalid, so a broken edit here is loud; a wrong one is not.

   **This push takes effect immediately** — it is not gated by a deploy.
   From this moment, Supabase trusts only the production issuer, so proceed
   straight to step 8. If the currently-deployed Production build hasn't
   redeployed onto the keys from step 2 yet, it is still issuing/expecting
   development-issuer tokens, and every request hits the empty-app symptom
   described at the top of this section.

8. **Redeploy Production.** Immediately after the previous step, not at the
   end of the checklist:

   ```bash
   npx vercel@latest --prod
   ```

   This is what makes the environment variables from step 2 — the
   `pk_live_…` / `sk_live_…` keys above all — actually take effect in the
   running app. Skip or delay this step and Production keeps running on
   whatever it last deployed with while Supabase (step 7) already trusts
   only the new issuer: signed in, `/dashboard` loads, silently empty, no
   errors. Do not let other work land between steps 7 and 8.

9. **Re-register Clerk in the Supabase dashboard.** Project
   `xomvbdvvrlbxoyqdsstt` → **Authentication** → **Sign In / Providers** →
   **Third Party Auth**. Add (or update) the Clerk entry with the production
   domain. This is the platform-side record; step 7 is the checked-in copy of
   it, and the two must agree.

10. **Verify in a real browser, against production.** Nothing above proves
    itself, and the failure mode is silent, so this is not optional:

    - Sign up with a new email/password account; land on `/dashboard`.
    - Sign out, sign in again.
    - Sign in with Google (this is what step 6 proves).
    - **Add one wishlist item.** This is the check that matters. It is the
      only step that proves the whole chain — Clerk issues the token, the
      `role` claim maps it to `authenticated`, Supabase trusts the issuer, and
      an RLS policy matched a write. A read returning rows can be explained
      away; a successful write cannot.
    - Open a group gift chat in two browsers and confirm a message arrives in
      realtime.
    - Confirm the new user has a profile row:

      ```bash
      npx supabase@latest db query "select id, username, email from user_profiles order by created_at desc limit 5" --linked
      ```

      A Clerk **production** user id appears (`user_…`). If the row is missing
      while sign-in succeeded, provisioning is failing, not authentication —
      `ensureProfile()` uses the service-role key and does not depend on any of
      the above.

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
- **next-themes** - Theme support
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
│   └── api/                   # API routes
├── components/                # React components
│   └── vibe/                  # Vibe component wrappers
├── lib/                       # Utilities and clients
│   ├── auth/                 # requireAuth + profile provisioning
│   ├── actions/              # Server actions
│   ├── supabase/             # Supabase clients (Clerk-authenticated)
│   ├── resend/               # Email templates
│   └── hooks/                # Custom React hooks
├── proxy.ts                  # clerkMiddleware + protected-route matcher
├── types/                    # TypeScript types
└── _planning/                # Project documentation
```

## Next Steps (From Plan)

See `_planning/rybn_plan.md` for the complete 8-week implementation plan:

- **Phase 2**: Groups & Invitations
- **Phase 3**: Profile System with Privacy Controls
- **Phase 4**: Wishlist with Privacy
- **Phase 5**: Gift Coordination & Chat
- **Phase 6**: Secret Santa Coordination
- **Phase 7**: Advanced Vibe Integration
- **Phase 8**: Testing & Deployment

## License

MIT
