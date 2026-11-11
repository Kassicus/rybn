# Rybn mobile — foundation design

**Status:** approved by Kason 2026-11-11, after one read by a fresh reviewer.
**Plan:** `_planning/2026-11-10-mobile-foundation-plan.md`.
**Part of:** `_planning/2026-11-10-mobile-app-overview.md` (read that first; it
holds the why, the agreed screens and the order of the pieces).
**Repos touched:** `rybn-mobile` (new iOS app), `rybn` (mobile API wrapper and
one endpoint).
**Modelled on:** `~/Documents/github/wpfc-mobile/docs/superpowers/specs/2026-10-03-mobile-foundation-design.md`,
and the code it produced in `~/Documents/github/wpfc-mobile` and
`~/Documents/github/wpfc-web/src/lib/mobile/`. Where this document says "as
Wilde", read that code; port it, do not reinvent it.

**(owner)** marks something Kason said. **(call)** marks a choice made while
designing that he has not been asked about directly.

## 1. Goal

A family member installs a TestFlight build of Rybn, signs in with the account
they already use on rybn.app, sees their own name, stays signed in across
launches, and can sign out. Underneath that sits everything the next two
pieces stand on: the repo, the look, the API client, the session, and the
mobile API wrapper on the website.

The foundation ships no wishlist, group or gift screens. Those are pieces 2 and
3 and get their own designs.

### What the owner said

- Structure it like the Wilde app: a website and a mobile app that talk to
  each other.
- iPhone first; Android only if usage grows beyond family and friends.
- Sign in with an existing rybn account, by email or Google.
- No notifications for now.
- On TestFlight before Christmas 2026 if possible. No hard deadline.

### Assumptions (call)

- iPhone only, iOS 18 or later. No iPad layout.
- Native SwiftUI, Swift 6 language mode.
- Light appearance only, like the site.
- Creating an account stays on the website until the public-release piece.

## 2. What rybn looks like today (constraints)

- **Identity is Clerk.** `lib/auth/require-auth.ts` is the choke point:
  `getUserId()`, `requireAuth()`, `requireAuthWithProfile()`, all built on
  `auth()` from `@clerk/nextjs/server`. `lib/auth/ensure-profile.ts` lazily
  creates the `user_profiles` row and is fail-soft: it returns the Clerk id
  even when the row could not be made.
- **Row-level security is the real access control.** `lib/supabase/server.ts`
  builds a Supabase client whose `accessToken` is Clerk's `getToken()`, so
  every query runs as the signed-in person. A few actions use the service-role
  client after their own checks (`lib/supabase/admin.ts`).
- **Clerk already accepts a bearer token.** `@clerk/backend` 3.16.10 parses the
  `Authorization` header (`node_modules/@clerk/backend/dist/chunk-XWICSJHA.mjs:642`)
  and authenticates from it when present (`:7648`,
  `authenticateRequestWithTokenInHeader`). So `auth()` should resolve a phone's
  request with no change to `require-auth.ts`, and `getToken()` should hand
  that same token on to Supabase. This is read from the code, not yet run. It
  is the first thing the plan proves (§9, criterion 3).
- **`proxy.ts` runs `clerkMiddleware` on every non-static path,** `/api`
  included, and calls `auth.protect()` only for the listed page prefixes.
  `auth.protect()` redirects to sign-in, which is wrong for an API.
- **Which Clerk issuer Supabase trusts is set in its dashboard, not in the
  repo.** The README ("Production configuration") and `supabase/config.toml`
  record one issuer, `clerk.rybn.app`, and warn that a token from any other
  issuer matches no policy and returns zero rows with no error. Yet
  `.env.local` uses a `pk_test_` key against the same Supabase project, and
  (owner) the local site shows data when signed in. So the dashboard evidently
  trusts the development issuer too. Nothing in the repo can confirm that;
  §9's first manual step does.
- **Actions never redirect, and report failure as `{ error }`.** Success is
  `{ data }` for reads, and `{ success: true }` or `{ ok }` for many writes
  (for example `lib/actions/gift-tracking.ts:212`, `lib/actions/claims.ts:129`).
  They call `revalidatePath`, which is harmless from a route handler.
- **Next.js 16.** `AGENTS.md` requires reading `node_modules/next/dist/docs/`
  before writing code. For this work:
  `01-app/01-getting-started/15-route-handlers.md` and
  `01-app/03-api-reference/03-file-conventions/route.md` (`params` is a
  Promise; `RouteContext<'/path/[id]'>` types it) and `proxy.md`.
- **zod is 4.1.** Wilde's wrapper is typed against zod 3
  (`z.ZodType<B, z.ZodTypeDef, unknown>`); the types need adjusting.
- **Tests are colocated.** `vitest.config.ts` includes `**/*.test.{ts,tsx}`.
  There is no `tests/` directory.
- **The look is defined once.** Colours are CSS variables in `app/globals.css`
  ("Evergreen & Cranberry"), each pair checked against WCAG. Body type is
  Quicksand, headings and figures are Lora (`app/layout.tsx`).
- **Work reaches `main` through pull requests** (see `git log`).

## 3. Decisions

| # | Decision | Choice | Why |
|---|---|---|---|
| D1 | App stack | Native SwiftUI, iPhone, iOS 18+, Swift 6 | (owner) like Wilde; no Android users; the share sheet in piece 2 is native work anyway |
| D2 | Data access | `/api/mobile/v1/*` on rybn, Clerk session token as bearer | Reuses the actions and their rules; an Android app later reuses the API |
| D3 | Sign-in screen | Clerk's prebuilt `AuthView` in sign-in-only mode, opened from a Rybn welcome screen | (call) See below |
| D4 | Push | None in the foundation | (owner) notifications come later. Wilde's `src/lib/push` ports across when they do |
| D5 | Distribution | TestFlight. Kason as internal tester, family as external testers | (owner) TestFlight before Christmas; public listing is a later piece |
| D6 | Project | New repo `rybn-mobile`, XcodeGen `project.yml`, local package `RybnKit` | As Wilde |
| D7 | Tabs in this build | Home and Account only | (call) No tab that leads nowhere; Wishlist, Groups and Gifts arrive with their pieces |
| D8 | Appearance | Light only | The site's deliberate choice |
| D9 | Where this document lives | `rybn/_planning/` now; copy into `rybn-mobile/docs/` once that repo exists | (call) The repo does not exist yet |

**D3 in full.** The choice is between Clerk's ready-made `AuthView` and a
sign-in screen of our own that calls `clerk.auth.signInWithPassword` and
`clerk.auth.signInWithOAuth(provider: .google)`.

`AuthView` is chosen because it already handles what a hand-built screen would
have to rediscover: email verification, password reset, a second factor, and
whatever extra step Clerk asks of a password sign-in from a device it has not
seen. Getting those wrong locks a family member out the week before Christmas.

Present it as `AuthView(mode: .signIn)`. clerk-ios documents that mode as
"Restricts the interface to sign-in flows only"
(`Sources/ClerkKitUI/Components/Auth/AuthView.swift` on its `main` branch, read
over the web on 2026-11-10; confirm in the installed package). So no account
can be created in the app, which is what the owner agreed for the first
build. The welcome screen sends someone without an account to
`https://rybn.app/register` in Safari.

Theme it to the palette through the `\.clerkTheme` environment value that
`AuthView` reads. If it cannot be made to look like Rybn, fall back to the
hand-built screen and say so in the plan; do not ship an off-brand sign-in
silently.

Rejected: talking to Supabase from the app; a web wrapper; a cross-platform
toolkit. Reasons are in the overview.

## 4. Architecture

```
 iPhone app (SwiftUI)                   rybn (Next.js on Vercel)                 Supabase
 ┌───────────────────────┐  sign in   ┌──────────────────────────────┐
 │ ClerkKit (session)    │───────────────────────▶ Clerk                         
 │ APIClient             │ Bearer JWT │ proxy.ts: clerkMiddleware    │
 │                       │───────────▶│ /api/mobile/v1/*  (thin)     │
 │                       │            │   → mobileRoute              │
 │                       │            │   → existing actions/readers │──▶ Postgres (RLS,
 └───────────────────────┘            └──────────────────────────────┘    as that user)
```

The app uses Clerk only to sign in and to mint a token. Every read and write
goes through `/api/mobile/v1/*`.

## 5. iOS app (`rybn-mobile`)

### 5.1 Project and layout

```
project.yml                 XcodeGen spec, source of truth for Rybn.xcodeproj
Rybn.xcodeproj              generated, committed
Rybn/                       app target
  App/                      RybnApp, RootView, MainTabView, Services, ClerkAuthService
  Features/Welcome/         the screen before sign-in
  Features/Home/
  Features/Account/
  Kit/                      Theme, Card, Buttons, Fields, Rows, EmptyState, HeroCard
  Preview/                  debug-only preview mode and kit gallery
  Fonts/                    Quicksand, Lora, and their OFL licence
  Config/                   Shared, Debug, Release xcconfig; Local.xcconfig.example
Packages/RybnKit/           everything testable without a simulator
  Sources/RybnKit/          AppConfig, APIClient, APIError, AppSession, Models,
                            Tabs, Palette, Contrast, Preview sample data and fakes
  Tests/RybnKitTests/       Swift Testing; Fixtures/ copied from rybn
RybnUITests/                launch and preview-mode smoke tests
docs/                       designs and plans, from this one onward
README.md                   as wpfc-mobile's: requirements, layout, working on it,
                            configuration, releasing
```

- Display name **Rybn**. Bundle ID `app.rybn.ios`: the removed wrapper's,
  which (owner) was never uploaded to Apple, so it is free. UI tests use
  `app.rybn.ios.uitests`.
- Dependencies: `https://github.com/clerk/clerk-ios`, products `ClerkKit` and
  `ClerkKitUI`. Nothing else. No `supabase-swift`. clerk-ios's `Package.swift`
  on `main` asks for Swift tools 6.2 and iOS 17 or later (read over the web;
  confirm at install).
- `Info.plist` reads `API_BASE_URL` and `CLERK_PUBLISHABLE_KEY` from the
  xcconfig; `ITSAppUsesNonExemptEncryption = NO`; `UIUserInterfaceStyle =
  Light`; the local-networking App Transport Security exception as Wilde; a URL
  scheme for Clerk's OAuth callback (Clerk's default is
  `<bundle-identifier>://callback`).
- Clerk publishable keys are public (the site ships them to every browser), so
  they are committed in the xcconfig files, as Wilde commits its Supabase
  public key.
- Build settings change in `project.yml` or the xcconfig files, never in
  Xcode's UI. After editing `project.yml` or adding or removing files, run
  `xcodegen generate` and commit the regenerated project.

### 5.2 Session and app state

`AppSession` (`@MainActor @Observable`, in RybnKit) owns the state, as Wilde's:

| State | Shown |
|---|---|
| `.launching` | Splash while Clerk restores its session and `/me` loads |
| `.signedOut(message: String?)` | Welcome screen, with an optional message |
| `.signedIn(Me)` | Tab shell |
| `.updateRequired` | "Update required" with a link (TestFlight for now) |
| `.unreachable` | "Can't reach Rybn" with Retry. No offline cache |

- **Launch.** `Clerk.configure(publishableKey:)` in the app's initializer, and
  `Clerk.shared` in the environment. Once Clerk has restored its stored
  session: a session means `GET /me`; none means `.signedOut(nil)`. `/me`
  success gives `.signedIn`; `401` gives `.signedOut`; a network failure gives
  `.unreachable`.
- **Sign in.** The welcome screen presents `AuthView`. When Clerk reports a
  user, call `/me`.
- **Foreground.** Re-fetch `/me` whenever the app becomes active, so a name or
  picture changed on rybn.app's profile page shows on the next open.
- **Sign out.** `clerk.auth.signOut()`, then `.signedOut(nil)`. Confirm on a
  real account that this ends the phone's session only and leaves the person
  signed in on rybn.app in their browser. Wilde hit exactly this with
  Supabase's default scope (its design, §14 items 6 and 12).
- RybnKit does not import Clerk. It sees an `AuthService` and an
  `AccessTokenProvider` protocol, implemented in the app by
  `ClerkAuthService`, so the session and client are testable with fakes. This
  is Wilde's `SupabaseAuthService` split.
- A phone that is offline, or Clerk being unreachable, must not read as signed
  out. Wilde's `SupabaseAuthService.tokenFailure` shows the mapping to keep.

### 5.3 APIClient

As Wilde's `APIClient.swift`, with one change of source for the token:

- Base URL from `AppConfig.apiBaseURL`. Every request sends
  `Authorization: Bearer <token>` and `X-App-Build: <CFBundleVersion>`.
- The token comes from `try await clerk.auth.getToken()` on every request.
  Clerk session tokens are short-lived; never store one.
- `401`: ask Clerk for a fresh token once and retry once. A second `401` moves
  the session to `.signedOut("Your session ended. Please sign in again.")`.
- `426` moves the session to `.updateRequired`.
- Other errors decode the envelope (§6.3) into `APIError`, carrying the
  server's `message` for display.
- JSON is camelCase with ISO-8601 dates.

### 5.4 Tabs

`Tabs.swift` in RybnKit declares all five tabs from the overview (Home,
Groups, Gifts, Wishlist, Account) with id, title and symbol, and a pure
function returning the ones this build shows. The foundation shows Home and
Account. There are no roles or permissions in rybn, so nothing here depends on
who is signed in.

### 5.5 Screens

- **Welcome.** The Rybn wordmark, the tagline "Tied together", a "Sign in"
  button that presents `AuthView(mode: .signIn)`, a quieter "New to Rybn?
  Create your account at rybn.app" link that opens `https://rybn.app/register`
  in Safari, and any sign-out message.
- **Home.** A time-of-day greeting with the person's display name (falling
  back to username), in the evergreen hero card from the overview's home
  sketch, and one line saying wishlists and gifts arrive in the next builds,
  with a link to open rybn.app. No occasion data: that is piece 3.
- **Account.** Picture, display name, `@username`, email, app version and
  build, and Sign out. Two links, both opening in Safari: "Edit profile" to
  `https://rybn.app/profile/edit`, which is where name and username live, and
  "Password and security" to the Clerk account portal
  (`https://accounts.rybn.app/user`).
- **Launching, Unreachable, Update required.** As Wilde's `StatusViews.swift`.

### 5.6 Look

- `Palette.swift` in RybnKit carries every colour token from `app/globals.css`
  under the same names. `PaletteTests` checks each text colour against the
  background it is used on for 4.5:1, as Wilde's does and as the site does.
- Quicksand for body text, Lora for headings and figures, bundled with their
  OFL licence. Type respects Dynamic Type.
- The kit is the small set the overview's sketches use: card, hero card,
  primary button (cranberry), secondary button, text field, row, chip, avatar
  with initials fallback, empty state.
- Appearance is forced to light in `Info.plist` and at the root view.
- App icon and launch mark from `app/icon.svg` and `public/brand/`.

### 5.7 Preview mode

Debug builds only, as Wilde's: launching with `-designPreview` shows any
screen signed in with sample data and no network, `-previewScreen <name>`
picks the screen, and a kit gallery shows every component. Release builds
contain none of it. (call) It is in the foundation because pieces 2 and 3 are
mostly screens, and this is how they get checked without an account.

## 6. Mobile API (`rybn`)

Built on a branch and merged by pull request.

### 6.1 Auth

No change to `lib/auth/require-auth.ts`. `/api/mobile` is **not** added to
`isProtectedRoute` in `proxy.ts`: a signed-out phone must get a `401` in the
envelope below, not a redirect to `/login`. `clerkMiddleware` still runs on
these paths through the existing matcher, which is what lets `auth()` work.

### 6.2 Route wrapper

`lib/mobile/route.ts` (pure: imports nothing from Next.js, Clerk or Supabase,
so tests drive it directly) and `lib/mobile/route-live.ts` (wires the real
dependencies), as Wilde's `route.ts` and `route-live.ts`.

`mobileRoute(handler, { query?, body? })` returns a route handler that, in
this order:

1. If `MOBILE_MIN_BUILD` is set and `X-App-Build` is missing or lower, answers
   `426 upgrade_required`.
2. Identifies the caller with `ensureProfile()`. `null` answers
   `401 unauthorized`.
3. Parses the query, then the JSON body, with the zod schemas given. A failure
   answers `422 invalid`, naming the first problem.
4. Runs the handler with `{ userId, query, body, params, request }`. A returned
   `Response` passes through; `null` or `undefined` answers `204`; anything
   else is sent as JSON.
5. Catches anything thrown, logs it with the path, and answers
   `500 server_error` with a generic message.

Every response carries `Cache-Control: no-store`. Rybn's data is private per
viewer and must not sit in a phone's URL cache.

`lib/mobile/action-response.ts` turns an action's result into an answer, as
Wilde's: `{ error: "Not authenticated" }` becomes `401`; any other `{ error }`
becomes `422` carrying the action's own message; `{ data }`,
`{ success: true }` and `{ ok }` are successes, and the route decides what to
send for them. Pieces 2 and 3 use it.

### 6.3 Error envelope

```json
{ "error": { "code": "unauthorized", "message": "Please sign in again." } }
```

| code | HTTP |
|---|---|
| `unauthorized` | 401 |
| `not_found` | 404 |
| `invalid` | 422 |
| `upgrade_required` | 426 |
| `server_error` | 500 |

Later pieces add codes as they need them.

### 6.4 Endpoint

**`GET /api/mobile/v1/me`**

```json
{
  "user": {
    "id": "user_2abcDEF",
    "username": "kason",
    "displayName": "Kason",
    "email": "kason@example.com",
    "avatarUrl": "https://img.clerk.com/abc"
  }
}
```

Read from `user_profiles` with the user-scoped client, after the wrapper's
`ensureProfile()`. `displayName`, `email` and `avatarUrl` may be null;
`username` may be null in the schema, though `ensureProfile()` always sets
one. If the row is missing (provisioning is fail-soft) answer
`500 server_error`, so the app shows Retry instead of a half-signed-in shell.

Do not reuse `getMyProfile()` here: it also loads every `profile_info` field
and returns raw database messages.

(call) `/me` shows what the site shows. `user_profiles` copies email and
picture from Clerk once, when the row is created (`lib/auth/ensure-profile.ts`,
the `ignoreDuplicates` upsert), and does not follow later changes made in
Clerk's portal. That is how the site behaves today and is not this piece's to
change.

### 6.5 Contract fixtures

`lib/mobile/fixtures/me.json` and `error.json`. rybn's tests assert the
handler output matches their shape. The same files are copied into
`rybn-mobile/Packages/RybnKit/Tests/RybnKitTests/Fixtures/` and decoded by
Swift tests. A contract change updates both copies together.

### 6.6 Configuration

Add to `.env.example`, and to Vercel when a minimum is first needed:

```
MOBILE_MIN_BUILD=        # optional; app builds below this get 426
```

## 7. Clerk setup

Done by Kason in the Clerk Dashboard, for the development instance and again
for production:

1. Native applications page: enable the Native API.
2. Add the iOS app there with its App ID Prefix (the Apple team ID) and
   Bundle ID.

In Xcode, the Associated Domains capability with
`webcredentials:<frontend API host>` (production: `clerk.rybn.app`) enables
password AutoFill and passkeys. (call) Include it if it costs nothing; skip it
if it complicates signing. Sign-in works without it.

Google sign-in goes through Clerk's OAuth flow and returns to the app by URL.
Route incoming URLs to `clerk.handle(url)` with `.onOpenURL`.

## 8. Environments

| | Debug (Xcode, simulator) | Release (TestFlight) |
|---|---|---|
| API | `http://localhost:3000`, or `Local.xcconfig` for a device or a Vercel preview | `https://rybn.app` |
| Clerk instance | development (`pk_test_`) | production (`pk_live_`) |
| Database | the one Supabase project | the one Supabase project |

- Use the apex `https://rybn.app`, not `www`. The README explains why the
  site must be served from the apex; a redirect in front of an API call is
  also one more thing that can drop the `Authorization` header.
- A debug build signs in against the development Clerk instance. (owner) The
  local site shows data when signed in, so a debug build should too.
  Development-instance accounts are separate people from production
  accounts: a debug build shows the test account's data, never the family's.
- A Vercel preview behind Deployment Protection will refuse the phone's calls.
  Use localhost or a protection bypass for device testing.

## 9. Testing

**rybn (vitest, colocated)**

- `lib/mobile/route.test.ts`: `426` for a missing or low build; `401` when
  nobody is identified; `422` for a bad query and a bad body, naming the
  problem; `204` for an empty result; a handler's own `Response` passing
  through; `500` with the error logged; `Cache-Control: no-store` on all of
  them; the order build, sign-in, query, body.
- `lib/mobile/me.test.ts`: output matches `fixtures/me.json`; nulls pass
  through; a missing row is a `500`.
- `lib/mobile/action-response.test.ts`: the three mappings.
- Gates: `npm run type-check`, `npm test` and `npm run build` pass.
  `npm run lint` already fails on `main` (61 problems on 2026-11-10; the
  README lists them as outstanding), so the gate there is no new findings.
  The RLS suite is untouched by this piece.

**rybn-mobile (Swift Testing in RybnKit)**

- APIClient: attaches both headers; one refresh and retry on `401`; a second
  `401` signs out; `426` gives update-required; the envelope decodes; a token
  failure caused by the network is not a sign-out.
- AppSession: every transition in §5.2.
- Fixtures decode. Tabs: this build shows Home and Account. Palette: contrast.
- `swift test --package-path Packages/RybnKit`, and `xcodebuild test` for the
  UI smoke tests: launch shows Welcome; preview mode shows each screen.

**Manual, end to end**

1. `curl` the local site's `/api/mobile/v1/me` with no token (expect the `401`
   envelope, not a redirect) and with a real session token (expect the
   fixture's shape with real values).
2. Simulator against the local site: sign in by email and by Google, relaunch
   (still signed in), background and foreground, sign out.
3. TestFlight build on a real phone against production: the same, then
   confirm the browser session on rybn.app survived the app's sign-out.

## 10. Out of scope

- Every wishlist, group, occasion, claim and gift screen and endpoint (pieces
  2 and 3), and the share extension.
- Push in any form, including device registration.
- Sign in with Apple, in-app account deletion, App Store listing and review.
- Offline cache, Face ID lock, widgets, iPad, Android, dark appearance.
- CI for the app.

## 11. TestFlight checklist

1. Apple Developer portal: an App ID for `app.rybn.ios` under (owner) the same
   personal account that publishes the Wilde app; its team ID is
   `DEVELOPMENT_TEAM` in `wpfc-mobile/WPFC/Config/Shared.xcconfig`. No
   capabilities are required; add Associated Domains if §7 keeps it.
2. App Store Connect: an app record named "Rybn" (or the nearest free name).
   Automatic signing in Xcode.
3. Version `1.0.0`. Raise the build number on every upload.
4. Internal testing first (Kason). Then an external group for family. The
   first external build goes through Beta App Review, which needs a demo
   account and a line explaining the app; the privacy policy is
   `https://rybn.app/privacy`. (owner) A password sign-in on a new device does
   not ask for an emailed code, so a demo account with a password is enough
   for the reviewer.
5. Releasing: bump the build in `Shared.xcconfig`, `xcodegen generate`,
   commit, Archive, upload. As wpfc-mobile's README.

## 12. Success criteria

1. A family member installs from TestFlight, signs in with their rybn.app
   account by email or Google, sees their own name and picture, stays signed
   in across relaunches, and can sign out.
2. Signing out of the app leaves them signed in on rybn.app in a browser.
3. `GET /api/mobile/v1/me` answers a phone's bearer token with that person's
   profile, read under RLS, with `require-auth.ts` unchanged; and answers no
   token with a `401` envelope.
4. The website behaves exactly as before; type-check, tests and build pass,
   and lint gains no new findings.
5. Debug builds reach a local site; Release builds reach `https://rybn.app`.
6. The preview mode shows every foundation screen with no network.

## 13. Risks

- **The bearer path is read from code, not run.** If `auth()` or `getToken()`
  behaves differently for a header token, D2 still holds but
  `require-auth.ts` needs a bearer branch, as Wilde's `verifyAdmin()` got.
  Proved first (§9 manual step 1).
- **The repo's record of the trusted issuer and the owner's experience
  differ** (§2). If a development token turns out to read nothing, the app
  would sign in and `/me` would answer `500`. Then either the development
  issuer is added in Supabase's dashboard, or signed-in testing moves to the
  live site as Wilde does. Proved first (§9 manual step 1).
- **Beta App Review** may object to Google sign-in without Sign in with
  Apple. If it does, Sign in with Apple moves ahead of the family test, or
  the family build goes to internal testers only. Its reviewer also needs a
  demo account that can actually sign in; §11 item 4 covers it.
- **`AuthView` may not take the brand.** Fallback in D3.
- **Clerk's native SDK is younger than its web one.** The pages read for this
  design did not document how a stored session is restored at launch or what
  `signOut()` ends. Check both in the installed package before building on
  them.

## 14. Answered by the owner (2026-11-10)

- **Local data.** Running the site locally and signing in shows data.
- **Bundle ID.** The old wrapper was never uploaded to App Store Connect or
  TestFlight. Use `app.rybn.ios` with a new app record.
- **Apple account.** The same personal account as the Wilde app.
- **New-device sign-in.** A password is enough; no emailed code.

Not asked, so (call): the repo is `Kassicus/rybn-mobile`, private, cloned next
to `rybn` at `~/Documents/github/rybn-mobile`. Creating it on GitHub is
confirmed with the owner when the plan reaches that step.

## 15. Left to the builder

- File-by-file structure inside the folders above, and names not given here.
- How far to theme `AuthView`, within D3's rule.
- Whether to keep Associated Domains (§7).
- The exact kit components beyond those listed, as screens need them.
- How the app waits for Clerk to restore its session, once read from the
  installed SDK.
