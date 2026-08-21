# Clerk Auth Migration & Capacitor Removal — Design

**Date:** 2026-08-21
**Status:** Approved, pending implementation plan

## Overview

Replace Supabase Auth with Clerk as the identity provider, and strip the
Capacitor iOS wrapper from the repository.

Supabase remains the database and continues to enforce Row Level Security.
What changes is who issues the token RLS trusts: Clerk's session token,
accepted via Supabase's native third-party auth integration, rather than a
token minted by Supabase Auth.

### Why now

Two properties of the current moment make this cheap, and both expire:

1. **All 14 tables are empty.** The project was repointed at a fresh Supabase
   project (`xomvbdvvrlbxoyqdsstt`) on 2026-08-21 and the previous project's
   data was explicitly abandoned. Identity columns can change type freely.
   Once real users sign up, `uuid → text` becomes a data migration.
2. **The migration chain is being rewritten anyway.** 26 of 51 migrations
   reference `auth.uid()`, which does not work with Clerk.

## Constraints

These are verified facts, not assumptions:

- **`auth.uid()` does not work with Clerk.** It expects a `uuid`; Clerk issues
  string IDs of the form `user_2abc…`. Policies must read
  `auth.jwt()->>'sub'` and identity columns must be `text`.
- **The JWT-template integration is deprecated** (April 2025). It shared the
  Supabase JWT secret with Clerk. The native third-party auth integration
  replaces it and is what this design uses.
- **Clerk session tokens require a `role: "authenticated"` claim.** Supabase
  rejects tokens without it.

### Current coupling (measured)

| Surface | Count |
|---|---|
| `auth.getUser()` call sites | 104 across 44 files |
| `auth.uid()` references in migrations | 139 across 26 files |
| `uuid` FKs to `auth.users(id)` | 19 |
| Triggers on `auth.users` | 1 (`on_auth_user_created`) |
| Server (RLS-enforced) client calls | 107 |
| Admin (RLS-bypassing) client calls | 21 |

The 107-to-21 split is why RLS is being kept rather than discarded: roughly
84% of database access relies on it, and the application's core feature is
controlling who can see what (wishlist secrecy, per-group privacy overrides).

## Decisions

| Decision | Choice | Rejected alternative |
|---|---|---|
| Authorization model | Keep RLS, Clerk as third-party auth provider | Drop RLS and enforce in app code; shadow `auth.users` synced by webhook |
| Schema path | Squash to a clean Clerk-native baseline | Layer new migrations on top |
| Auth UI | Clerk prebuilt components, themed | Headless hooks with existing forms; hybrid |
| Profile provisioning | Lazy upsert on first authenticated request | Clerk `user.created` webhook |
| Sign-in methods | Parity: email/password + Google | — |
| Capacitor | Remove entirely | — |

## Architecture

### Token flow

Supabase clients receive an `accessToken` callback instead of managing
cookies. All cookie handling moves to Clerk.

`@supabase/supabase-js` (v2.76.1, already installed) accepts
`accessToken?: () => Promise<string | null>` directly. Because
`@supabase/ssr` exists solely to manage cookie-based Supabase sessions, and
there are no longer any, **the `@supabase/ssr` dependency is removed** and
all three client factories use plain `createClient` from
`@supabase/supabase-js`.

- **Server components / actions:** `const { getToken } = await auth()` from
  `@clerk/nextjs/server`, passed as `accessToken`.
- **Browser:** `useSession()` from `@clerk/nextjs`, passing
  `session?.getToken()`.
- **Admin client:** unchanged. Uses the service-role key and bypasses RLS.

### Middleware

`clerkMiddleware()` replaces `updateSession`. Route protection moves from the
hand-maintained `protectedRoutes` array in `lib/supabase/middleware.ts` to
Clerk's `createRouteMatcher`. The cookie `getAll`/`setAll` machinery is
deleted outright.

### Configuration

- **Supabase dashboard:** register Clerk as a third-party auth provider.
- **`supabase/config.toml`:** does not currently exist; create it with the
  `[auth.third_party.clerk]` block so local development matches production.
- **Clerk dashboard:** add the `role: "authenticated"` session token claim.
- **Provisioning:** via the Vercel Marketplace Clerk integration, which
  syncs `CLERK_*` environment variables across all three Vercel environments
  automatically.

## Database

A single baseline migration replaces all 51 existing files, which are
archived rather than edited.

### Identity model

`auth.users` leaves the schema entirely. The 19 foreign keys re-point at
`user_profiles(id)`, which becomes a `text` primary key holding the Clerk
user ID. This preserves referential integrity and cascade deletes without
depending on a Supabase-owned table.

All identity columns — `user_id`, `created_by`, `invited_by`,
`target_user_id`, `assigned_to`, `claimed_by`, `celebrant_id`,
`notified_user_id` — become `text`.

### Policy form

```sql
create function requesting_user_id() returns text
language sql stable as $$
  select auth.jwt()->>'sub'
$$;
```

Policies read `(select requesting_user_id()) = user_id`. The `select`
wrapper is required for performance: it lets Postgres evaluate the claim
once per query rather than once per row.

### RLS recursion

The existing `group_members` policies recurse — they query `group_members`
from inside a `group_members` policy. This is the root cause of the 21
admin-client bypasses and of the `temporarily_disable_groups_rls` /
`reenable_groups_rls` pair in the current chain.

The baseline fixes this with `SECURITY DEFINER` membership helpers that read
the table with RLS suspended, breaking the cycle. Domain functions
(`can_view_field`, `get_shared_groups`) are retained with `uuid` parameters
widened to `text`.

This is the highest-uncertainty part of the design. If it proves more
involved than expected, the fallback is porting the existing policy logic
verbatim and keeping the admin-client bypasses.

### Profile provisioning

The `on_auth_user_created` trigger is deleted. Nothing in application code
currently inserts `user_profiles` rows — the trigger was the only path.

Replacement: a lazy upsert in the middleware path that already reads
`user_profiles` to check the username. This avoids webhook infrastructure,
avoids the race where a user reaches the app before a webhook fires, and
self-heals if a row goes missing. Cost is one upsert on a user's first
request after signup.

Clerk owns the username; `user_profiles.username` becomes a synced cache.
The column stays because queries and policies join on it.

## Application layer

### Choke point

`requireAuth()` in `lib/utils/authorization.ts` becomes the single wrapper
around Clerk's `auth()`. The 104 `auth.getUser()` call sites route through
it rather than reaching for a Supabase client directly.

### Deleted

- `app/auth/callback/route.ts` — Clerk handles the OAuth round trip
- `app/(auth)/set-username/` — Clerk collects usernames at sign-up
- `app/(auth)/verify-email/` — Clerk handles verification
- `components/auth/OAuthButton.tsx`
- `lib/actions/auth.ts` (`signupFromInvitation`)
- Cookie handling in `lib/supabase/middleware.ts`
- The `@supabase/ssr` dependency (see Token flow above)

### Reworked

- `app/(auth)/login/`, `app/(auth)/register/` — replaced by Clerk
  `<SignIn/>` / `<SignUp/>`, themed via the `appearance` API to match the
  existing palette and fonts.
- `app/(auth)/accept-invite/` — currently creates a pre-confirmed user via
  `auth.admin.createUser` and immediately signs them in. Becomes a normal
  Clerk sign-up followed by consuming the invite token.
- `lib/hooks/useAuth.ts` — thin pass-through to Clerk's `useUser`.

## Capacitor removal

Independent of the auth work and sequenced first.

Delete `ios/` (15 files), `lib/capacitor/`, and `capacitor.config.ts`.
Remove six packages: `@capacitor/{app,browser,camera,core,ios}` and
`@capacitor/cli`.

Only two application files import it. `components/ui/image-input.tsx`
reverts to a plain file input; `components/auth/OAuthButton.tsx` is deleted
by the auth work regardless.

CSP: drop `frame-ancestors 'self' capacitor: ionic:` and tighten
`X-Frame-Options` from `SAMEORIGIN` to `DENY`. Revisit the
`Permissions-Policy` camera grant, which exists for the native camera.

Note the iOS app was a remote-URL wrapper (`server.url = "https://rybn.app"`)
rather than a bundled static export, so removal has no effect on the web
build.

## Sequencing

Three independently verifiable commits:

1. **Capacitor removal** — self-contained, no auth dependency.
2. **Schema baseline + Clerk/Supabase configuration** — requires a
   `db reset`, which is free while tables are empty.
3. **Application cutover** — middleware, clients, call sites, UI.

## Risks

**Realtime (highest).** `components/gifts/ChatWindow.tsx` uses Supabase
realtime. Realtime authenticates its websocket separately from HTTP
requests, so the `accessToken` callback does not automatically cover it, and
Clerk tokens are short-lived enough that the socket needs re-auth on
refresh. Verify with a spike early rather than discovering it at the end.

**RLS recursion redesign (medium).** See above; fallback is a verbatim port.

**Invite flow (low-medium).** The only flow that changes shape rather than
just changing calls.

**Pricing (none expected).** Clerk's free tier covers 10k MAU.

## Success criteria

- A user can sign up, sign in, and sign out via Clerk on web.
- Google OAuth completes and lands the user authenticated.
- `user_profiles` rows are created automatically on first authenticated
  request, with the Clerk user ID as the primary key.
- RLS demonstrably enforces isolation: a user cannot read another user's
  private wishlist items or profile fields via the anon client.
- Group-scoped privacy overrides behave as they did before.
- Realtime chat delivers messages between two authenticated users.
- The invite flow creates an account and joins the correct group.
- `npm run type-check` and `npm run build` pass.
- No `@capacitor/*` package, `ios/` directory, or Capacitor reference
  remains.
- No reference to `auth.uid()` or `auth.users` remains in application code
  or migrations, and `@supabase/ssr` is absent from `package.json`.
