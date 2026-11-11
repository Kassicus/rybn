# Rybn Mobile Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A family member installs a TestFlight build of Rybn, signs in with their rybn.app account, sees their own name, stays signed in, and can sign out; with the repo, look, API client, session and website wrapper that pieces 2 and 3 build on.

**Architecture:** A new native SwiftUI app (`rybn-mobile`) signs in with Clerk's iOS SDK and does every read and write through `/api/mobile/v1/*` on the existing Next.js site (`rybn`), sending its Clerk session token as a bearer token. The site gains a thin route wrapper and one endpoint, `GET /me`; its auth code does not change. Both repos hold copies of the same JSON contract fixtures.

**Tech Stack:** Swift 6 language mode, SwiftUI, iOS 18+, XcodeGen, Swift Testing, clerk-ios (`ClerkKit`, `ClerkKitUI`); Next.js 16 route handlers, zod 4, vitest.

**Spec:** `_planning/2026-11-10-mobile-foundation-design.md` (approved 2026-11-11). Read it and `_planning/2026-11-10-mobile-app-overview.md` before starting. Section numbers below (§) refer to the design.

**Port, don't reinvent.** Most of this exists in the Wilde pair. Each task names the file to port from:
- site: `~/Documents/github/wpfc-web/src/lib/mobile/` and `~/Documents/github/wpfc-web/tests/mobile-*.test.ts`
- app: `~/Documents/github/wpfc-mobile/`

**Steps marked [Kason]** need the owner: a sign-in, a dashboard, a download, a push or an upload. Stop and ask; do not work around them.

## Global Constraints

- iPhone only, iOS 18.0 minimum, portrait, light appearance only (`UIUserInterfaceStyle = Light`).
- Swift language mode 6 (`SWIFT_VERSION: "6.0"`), strict concurrency. This Mac has Xcode 27.0 and Swift 6.4.
- App dependencies: `https://github.com/clerk/clerk-ios`, products `ClerkKit` and `ClerkKitUI`. Nothing else. No `supabase-swift`.
- `RybnKit` never imports Clerk. It sees `AuthService` and `AccessTokenProvider` only.
- Display name `Rybn`. Bundle ID `app.rybn.ios`; UI tests `app.rybn.ios.uitests`.
- API base: Debug `http://localhost:3000`, Release `https://rybn.app` (the apex, never `www`).
- A session token is fetched for every request and never stored.
- Build settings change only in `project.yml` or `Rybn/Config/*.xcconfig`. After editing `project.yml` or adding or removing files, run `xcodegen generate` and commit the regenerated project with the change.
- No push code of any kind, and no account creation in the app.
- Site: `lib/auth/require-auth.ts` is not modified. `/api/mobile` is not added to `isProtectedRoute` in `proxy.ts`.
- Site: every mobile response carries `Cache-Control: no-store`. JSON keys are camelCase.
- Site: read `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md` and `.../03-api-reference/03-file-conventions/route.md` before writing a route (`AGENTS.md` requires it). `params` is a Promise.
- Site: zod is 4.1. Wilde's wrapper is typed for zod 3.
- Site: tests are colocated (`*.test.ts` next to the code). Gates: `npm run type-check`, `npm test`, `npm run build` pass; `npx eslint .` reports no more than today's `61 problems (52 errors, 9 warnings)`.
- Site work happens on branch `mobile-api` and reaches `main` by pull request. Commit style follows `git log` (`feat(mobile): …`).
- Words shown to people are fixed where this plan quotes them. Do not reword.

## Review Focus

Inputs the design implies but does not spell out, most likely first. Each has a test in the task named.

1. **A 401 that is not the API's own envelope** (a Vercel protection page, a proxy's HTML). It must not sign the person out. Task 5.
2. **No network, or Clerk unreachable, while fetching a token.** The app shows "Can't reach Rybn", and the person stays signed in. Tasks 5 and 6.
3. **A profile with no display name, email or picture.** Home greets by username, the avatar shows initials, nothing reads "null". Tasks 2, 5, 7 and 10.
4. **A `/me` reply that lands after sign-out, or after someone else signs in.** It must not bring the first person's profile back. Task 6.
5. **A picture address that is not a valid URL.** `/me` still decodes and the avatar falls back to initials. Task 5.

---

# Part A — the website (`rybn`)

Work in a worktree on branch `mobile-api` cut from `main` (superpowers:using-git-worktrees). The three `_planning/2026-11-10-mobile-*.md` files are untracked in the main checkout, so a new worktree will not have them: copy them in and make them the branch's first commit.

### Task 1: Route wrapper and action failures

**Files:**
- Create: `lib/mobile/route.ts`, `lib/mobile/action-response.ts`, `lib/mobile/fixtures/error.json`
- Test: `lib/mobile/route.test.ts`, `lib/mobile/action-response.test.ts`
- Port from: `wpfc-web/src/lib/mobile/route.ts`, `action-response.ts`, `wpfc-web/tests/mobile-route.test.ts`, `mobile-action-response.test.ts`

**Interfaces:**
- Consumes: nothing. `route.ts` imports nothing from Next.js, Clerk or Supabase.
- Produces:

```ts
// lib/mobile/route.ts
export type MobileErrorCode = "unauthorized" | "not_found" | "invalid" | "upgrade_required" | "server_error";
export function mobileError(code: MobileErrorCode, message?: string): Response; // { error: { code, message } }
export interface MobileContext<B, Q> {
  userId: string;
  body: B;
  query: Q;
  params: Record<string, string>;
  request: Request;
}
export interface MobileRouteDeps {
  /** The signed-in person's Clerk id, or null when nobody is signed in. */
  identify: () => Promise<string | null>;
  minBuild: () => number | null;
}
export function parseMinBuild(value: string | undefined): number | null;
export function createMobileRoute(deps: MobileRouteDeps): <B = undefined, Q = undefined>(
  handler: (ctx: MobileContext<B, Q>) => Promise<unknown>,
  options?: { body?: /* zod schema whose output is B */; query?: /* zod schema whose output is Q */ },
) => (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

// lib/mobile/action-response.ts
export const NOT_SIGNED_IN = "Not authenticated";
export const ACTION_FALLBACK = "That didn't work. Please try again.";
/** A Response when the action failed, or null when it succeeded. */
export function actionFailure(result: { error?: string }): Response | null;
```

Status and default message per code:

| code | status | message |
|---|---|---|
| `unauthorized` | 401 | `Please sign in again.` |
| `not_found` | 404 | `That isn't there any more.` |
| `invalid` | 422 | `That request wasn't valid.` |
| `upgrade_required` | 426 | `This version of Rybn is out of date. Please update it.` |
| `server_error` | 500 | `Something went wrong. Please try again.` |

`lib/mobile/fixtures/error.json`:

```json
{ "error": { "code": "unauthorized", "message": "Please sign in again." } }
```

- [ ] **Step 1: Write `lib/mobile/route.test.ts`.** Helpers as Wilde's (`request({ build?, body?, search? })`, `noParams`, `route(deps)` defaulting to `identify: async () => "user_1"`, `minBuild: () => null`). Tests:
  - `passes the signed-in user id to the handler and returns its JSON`: handler `({ userId }) => ({ id: userId })` gives 200 and `{ id: "user_1" }`.
  - `marks every answer no-store`: a JSON answer, a 204, a handler's own `new Response("teapot", { status: 418 })`, `Response.redirect("http://localhost/elsewhere", 302)` (immutable headers), a thrown error, a 426 and a 401 all have `cache-control: no-store`.
  - `answers 204 with no body when the handler returns nothing`.
  - `hands dynamic route params to the handler`: `{ params: Promise.resolve({ id: "abc" }) }` reaches the handler.
  - `answers 426 when the build is missing or below the minimum`: `minBuild: () => 5`; no header, `"4"` and `"abc"` give 426 with code `upgrade_required`; `"5"` gives 200.
  - `never checks the build when no minimum is set`.
  - `answers 401 in the envelope when nobody is signed in`: `identify: async () => null`; body deep-equals `fixtures/error.json`.
  - `checks the build, then sign-in, then the query, then the body`: low build and signed out gives 426; signed out with a bad body gives 401; bad query and bad body gives the query's 422.
  - `answers 422 naming the first problem in the query`: schema `z.object({ page: z.coerce.number().int().min(1) })`, `?page=0`; code `invalid`, message starts `page:`.
  - `answers 422 for a body that is not JSON or does not match`: non-JSON body and `{ name: 5 }` against `z.object({ name: z.string() })`.
  - `hands the parsed query and body to the handler`: `?page=2` arrives as the number `2`.
  - `answers 500 with the generic message and logs the path when the handler throws`: `console.error` spy called with a string containing `/api/mobile/v1/thing`; the thrown text is not in the body.
  - `answers 500, not 401, when identifying the caller throws`.
  - `parseMinBuild`: `undefined`, `""` and `"abc"` give `null`; `"12"` gives `12`.
- [ ] **Step 2: Run `npx vitest run lib/mobile/route.test.ts`.** Expected: fails, cannot resolve `./route`.
- [ ] **Step 3: Implement `lib/mobile/route.ts`** from Wilde's, with these differences: no `image` option; the five codes above only; `identify` returning `null` replaces `verifyAdmin` throwing; the schema option types accept a zod 4 schema with coercion or transforms.
- [ ] **Step 4: Run the test.** Expected: all pass.
- [ ] **Step 5: Write `lib/mobile/action-response.test.ts`:**
  - `{ error: "Not authenticated" }` gives 401 with code `unauthorized`.
  - `{ error: "Failed to load upcoming occasions." }` gives 422, code `invalid`, that exact message.
  - `{ error: "" }` gives 422 with `ACTION_FALLBACK`.
  - `{ data: [] }`, `{ success: true }`, `{ ok: false }` and `{}` give `null`.
- [ ] **Step 6: Run it (fails), implement `actionFailure`, run it (passes).**
- [ ] **Step 7: `npm run type-check`, then commit.**

```bash
git add lib/mobile && git commit -m "feat(mobile): route wrapper and error envelope for the app's API"
```

### Task 2: `GET /api/mobile/v1/me`

**Files:**
- Create: `lib/mobile/me.ts`, `lib/mobile/me-live.ts`, `lib/mobile/route-live.ts`, `app/api/mobile/v1/me/route.ts`, `lib/mobile/fixtures/me.json`
- Test: `lib/mobile/me.test.ts`, `lib/mobile/me-live.test.ts`, `app/api/mobile/v1/me/route.test.ts`
- Modify: `.env.example`, `README.md`
- Port from: `wpfc-web/src/lib/mobile/me.ts`, `route-live.ts`, `wpfc-web/src/app/api/mobile/v1/me/route.ts`

**Interfaces:**
- Consumes: `createMobileRoute`, `parseMinBuild` (Task 1); `ensureProfile()` from `lib/auth/ensure-profile.ts` (returns the Clerk id or `null`); `createClient()` from `lib/supabase/server.ts`.
- Produces:

```ts
// lib/mobile/me.ts (pure)
export interface MeResponse {
  user: { id: string; username: string | null; displayName: string | null; email: string | null; avatarUrl: string | null };
}
export type ProfileRow = { id: string; username: string | null; display_name: string | null; email: string | null; avatar_url: string | null };
export function meResponse(row: ProfileRow): MeResponse;

// lib/mobile/me-live.ts
/** The caller's own row, read under RLS. Throws when it is missing or the read fails. */
export async function loadMe(userId: string): Promise<MeResponse>;

// lib/mobile/route-live.ts
export const mobileRoute; // createMobileRoute({ identify: ensureProfile, minBuild: () => parseMinBuild(process.env.MOBILE_MIN_BUILD) })

// app/api/mobile/v1/me/route.ts
export const dynamic = "force-dynamic";
export const GET; // mobileRoute(({ userId }) => loadMe(userId))
```

`lib/mobile/fixtures/me.json`:

```json
{
  "user": {
    "id": "user_2abcDEF",
    "username": "sam",
    "displayName": "Sam Rivera",
    "email": "sam@example.com",
    "avatarUrl": "https://img.clerk.com/abc"
  }
}
```

- [ ] **Step 1: Write `lib/mobile/me.test.ts`:**
  - `matches the contract fixture`: `meResponse({ id: "user_2abcDEF", username: "sam", display_name: "Sam Rivera", email: "sam@example.com", avatar_url: "https://img.clerk.com/abc" })` deep-equals the parsed `fixtures/me.json`.
  - `passes nulls through`: null `username`, `display_name`, `email`, `avatar_url` come out as `null`, not `"null"` or `""`.
  - `sends exactly five fields`: `Object.keys(result.user).sort()` equals `["avatarUrl", "displayName", "email", "id", "username"]`.
- [ ] **Step 2: Run it (fails), implement `meResponse`, run it (passes).**
- [ ] **Step 3: Write `lib/mobile/me-live.test.ts`,** mocking `@/lib/supabase/server` the way `lib/actions/claims.test.ts` does:
  - `reads the caller's own row with the user-scoped client`: `from("user_profiles")`, `select("id, username, display_name, email, avatar_url")`, `eq("id", "user_1")`, `maybeSingle()`.
  - `throws when there is no row` (`{ data: null, error: null }`).
  - `throws when the read fails` (`{ data: null, error: { message: "boom" } }`).
- [ ] **Step 4: Run it (fails), implement `loadMe`, run it (passes).**
- [ ] **Step 5: Write `app/api/mobile/v1/me/route.test.ts`,** mocking `@/lib/auth/ensure-profile` and `@/lib/mobile/me-live`:
  - `answers 401 in the envelope when nobody is signed in`: `ensureProfile` resolves `null`; status 401; body deep-equals `fixtures/error.json`; `loadMe` not called.
  - `answers the profile for the signed-in person`: status 200; body deep-equals `fixtures/me.json`; `loadMe` called with the id `ensureProfile` returned.
  - `answers 500 when the profile row is missing`: `loadMe` rejects; status 500; code `server_error`.
- [ ] **Step 6: Run it (fails), write `route-live.ts` and the route, run it (passes).**
- [ ] **Step 7: Add to `.env.example`:**

```
# Mobile app
# Optional. App builds whose X-App-Build is below this number get 426 (update required).
MOBILE_MIN_BUILD=
```

- [ ] **Step 8: Add a "Mobile API" section to `README.md`** after "Checks": routes live under `app/api/mobile/v1/`, every one is built with `mobileRoute` from `lib/mobile/route-live.ts`; `/api/mobile` is deliberately absent from `proxy.ts`'s protected list because the app needs a 401, not a redirect; `lib/mobile/fixtures/*.json` are the contract and are copied into `rybn-mobile/Packages/RybnKit/Tests/RybnKitTests/Fixtures/`, so change both together.
- [ ] **Step 9: Run the gates.** `npm run type-check` and `npm test` pass; `npm run build` passes and lists `/api/mobile/v1/me`; `npx eslint . 2>/dev/null | tail -1` reports at most `61 problems`.
- [ ] **Step 10: Commit.**

```bash
git add lib/mobile app/api/mobile .env.example README.md && git commit -m "feat(mobile): GET /api/mobile/v1/me"
```

### Task 3: Prove it with a real token, then open the pull request

This is §9 manual step 1 and §12 criterion 3. It settles the two unproven points in §13. No code is written unless a step says so.

- [ ] **Step 1: Start the site** (`npm run dev`) and ask it with no token:

```bash
curl -s -i http://localhost:3000/api/mobile/v1/me | head -20
```

Expected: `HTTP/1.1 401`, `cache-control: no-store`, body `{"error":{"code":"unauthorized","message":"Please sign in again."}}`. A `307` to `/login` means `proxy.ts` is protecting the path; that is a bug to fix here.

- [ ] **Step 2 [Kason]: Get a real token.** Sign in at `http://localhost:3000` in a browser, open the console, run `await window.Clerk.session.getToken()`, and paste the result into the command below within a minute (tokens are short-lived):

```bash
curl -s -H "Authorization: Bearer PASTE_TOKEN" http://localhost:3000/api/mobile/v1/me
```

- [ ] **Step 3: Read the result.**
  - `200` with that account's `user`: the bearer path and local data are both proven. Continue.
  - `401`: Clerk is not honouring the header. Stop and report. The design's fallback (§13, a bearer branch in `require-auth.ts`) needs Kason's go-ahead.
  - `500`: check the dev server log. A missing-row error means Supabase does not trust the development issuer. Stop and report; §13 lists the two ways forward.
- [ ] **Step 4: Check the build gate.** Restart with `MOBILE_MIN_BUILD=5 npm run dev`; `curl -s -i -H "X-App-Build: 4" http://localhost:3000/api/mobile/v1/me | head -1` gives `426`. Restart without it.
- [ ] **Step 5 [Kason]: Push `mobile-api` and open the pull request.** Ask before pushing. The description says what was proven in steps 1 to 4. Part B can start as soon as step 3 passes; it does not wait for the merge. Task 11 does.

---

# Part B — the app (`rybn-mobile`)

A new repo at `~/Documents/github/rybn-mobile`. `git init` there; work on `main` until it has a remote. **[Kason]** Creating `Kassicus/rybn-mobile` (private) on GitHub and pushing is confirmed with him at the end of Task 4.

Commands used throughout:

```bash
swift test --package-path Packages/RybnKit
xcodegen generate
xcodebuild test -project Rybn.xcodeproj -scheme Rybn \
  -destination 'platform=iOS Simulator,name=iPhone 17' \
  -skipMacroValidation -skipPackagePluginValidation CODE_SIGNING_ALLOWED=NO
```

### Task 4: A project that builds, launches and reads its settings

**Files:**
- Create: `.gitignore`, `project.yml`, `README.md`, `Rybn/Info.plist`, `Rybn/Config/Shared.xcconfig`, `Debug.xcconfig`, `Release.xcconfig`, `Local.xcconfig.example`, `Rybn/App/RybnApp.swift`, `Rybn/Assets.xcassets`, `Packages/RybnKit/Package.swift`, `Packages/RybnKit/Sources/RybnKit/AppConfig.swift`, `RybnUITests/LaunchTests.swift`, generated `Rybn.xcodeproj`, `docs/` (copy the three `_planning/2026-11-10-mobile-*.md` files from rybn)
- Test: `Packages/RybnKit/Tests/RybnKitTests/AppConfigTests.swift`
- Port from: `wpfc-mobile/project.yml`, `.gitignore`, `WPFC/Config/*`, `WPFC/Info.plist`, `Packages/WPFCKit/Package.swift`, `AppConfig.swift`, `AppConfigTests.swift`, `README.md`

**Interfaces:**
- Produces:

```swift
public struct AppConfig: Equatable, Sendable {
  public let apiBaseURL: URL
  public let clerkPublishableKey: String
  /// Where "Update required" sends people. Nil until there is a TestFlight link.
  public let updateURL: URL?
  public let version: String
  public let build: String
  public enum ConfigError: Error, Equatable { case missing(String) }
  public init(info: [String: Any]) throws
  public var versionLabel: String        // "1.0.0 (1)"
  public var registerURL: URL            // <apiBaseURL>/register
  public var editProfileURL: URL         // <apiBaseURL>/profile/edit
  public var privacyPolicyURL: URL       // <apiBaseURL>/privacy
  public var termsURL: URL               // <apiBaseURL>/terms
  public static let accountPortalURL: URL // https://accounts.rybn.app/user
}
```

Settings:

| Where | Key | Value |
|---|---|---|
| `Shared.xcconfig` | `DEVELOPMENT_TEAM` | the value in `wpfc-mobile/WPFC/Config/Shared.xcconfig` |
| `Shared.xcconfig` | `MARKETING_VERSION` | `1.0.0` |
| `Shared.xcconfig` | `CURRENT_PROJECT_VERSION` | `1` |
| `Shared.xcconfig` | `UPDATE_URL` | empty until Task 11 |
| `Debug.xcconfig` | `API_BASE_URL` | `http:/$()/localhost:3000` |
| `Debug.xcconfig` | `CLERK_PUBLISHABLE_KEY` | the `pk_test_` value of `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in `rybn/.env.local` |
| `Release.xcconfig` | `API_BASE_URL` | `https:/$()/rybn.app` |
| `Release.xcconfig` | `CLERK_PUBLISHABLE_KEY` | empty until Task 11, with a comment saying so |

`Info.plist` keys read by `AppConfig`: `APIBaseURL`, `ClerkPublishableKey`, `UpdateURL`, `CFBundleShortVersionString`, `CFBundleVersion`. Also set `CFBundleDisplayName` = `Rybn`, `ITSAppUsesNonExemptEncryption` = false, `LSRequiresIPhoneOS`, `NSAllowsLocalNetworking`, `UIUserInterfaceStyle` = `Light`, portrait only. `project.yml` is Wilde's with the names changed, no entitlements file, no Supabase package, and `xcodeVersion` matching the installed Xcode.

- [ ] **Step 1: Write `AppConfigTests.swift`** (Swift Testing):
  - `readsTheSettings`: a full dictionary gives each property; `versionLabel` is `"1.0.0 (7)"` for version `1.0.0`, build `7`.
  - `rejectsASettingTheXcconfigNeverDefined`: `APIBaseURL` = `"$(API_BASE_URL)"` throws `.missing("APIBaseURL")`; the same for `ClerkPublishableKey`.
  - `rejectsABaseURLThatIsNotHTTP`: `"ftp://rybn.app"` throws.
  - `updateURLIsOptional`: missing or empty `UpdateURL` gives `nil`.
  - `buildsTheSiteLinks`: with base `https://rybn.app`, `registerURL` is `https://rybn.app/register`, `editProfileURL` is `https://rybn.app/profile/edit`, `privacyPolicyURL` is `https://rybn.app/privacy`, `termsURL` is `https://rybn.app/terms`.
- [ ] **Step 2: Create `Package.swift`** (`RybnKit`, platforms `.iOS(.v18)`, `.macOS(.v15)`, test target with `resources: [.copy("Fixtures")]` and an empty `Fixtures/` holding a `.gitkeep`). Run `swift test --package-path Packages/RybnKit`. Expected: fails, `AppConfig` not found.
- [ ] **Step 3: Implement `AppConfig`.** Run the tests. Expected: pass.
- [ ] **Step 4: Create the project files and a placeholder `RybnApp`** whose window shows `Text("Rybn")`. Run `xcodegen generate`.
- [ ] **Step 5: Write `RybnUITests/LaunchTests.swift`** with `testAppLaunches`: `app.staticTexts["Rybn"].waitForExistence(timeout: 15)`. Run the `xcodebuild test` command. Expected: `** TEST SUCCEEDED **`.
- [ ] **Step 6: Write `README.md`** on Wilde's outline: Requirements, Layout, Working on it, Configuration, Contract fixtures, Releasing (a stub pointing at Task 11).
- [ ] **Step 7: Commit.** `git add -A && git commit -m "Start the Rybn app: project, settings and a launch test"`
- [ ] **Step 8 [Kason]: Create the private GitHub repo `Kassicus/rybn-mobile` and push.** Ask first.

### Task 5: API client and models

**Files:**
- Create: `Packages/RybnKit/Sources/RybnKit/APIError.swift`, `APIClient.swift`, `Models.swift`; `Tests/RybnKitTests/Fakes.swift`, `Fixture.swift`, `Fixtures/me.json`, `Fixtures/error.json` (byte-for-byte copies of `rybn/lib/mobile/fixtures/`)
- Test: `Tests/RybnKitTests/APIClientTests.swift`, `ModelsTests.swift`
- Port from: `wpfc-mobile/Packages/WPFCKit/Sources/WPFCKit/APIError.swift`, `APIClient.swift` (the protocols, `URLSessionTransport`, `send`, `tokenFailure`, `perform`, `decode`, `JSONDecoder.api`), and `Tests/WPFCKitTests/Fakes.swift`, `Fixture.swift`, `APIClientTests.swift`

**Interfaces:**
- Produces:

```swift
public struct Me: Codable, Equatable, Sendable { public let user: RybnUser }
/// Named RybnUser because Clerk's SDK has its own `User`.
public struct RybnUser: Codable, Equatable, Sendable, Identifiable {
  public let id: String
  public let username: String?
  public let displayName: String?
  public let email: String?
  /// Kept as text: a bad address must not stop /me decoding.
  public let avatarUrl: String?
  public var avatarURL: URL? { get }   // nil unless http or https
  public var name: String { get }      // displayName, else username, else "there"; blank counts as missing
}

public enum APIError: Error, Equatable, Sendable {
  case unauthorized, notFound(String), invalid(String), upgradeRequired, server(String), network(String), decoding
  public var message: String { get }
  static func check(status: Int, body: Data) throws
}
public protocol AccessTokenProvider: Sendable {
  func accessToken() async throws -> String
  func refreshedAccessToken() async throws -> String
}
public protocol HTTPTransport: Sendable { func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) }
public struct URLSessionTransport: HTTPTransport { public init() }  // no URL cache
public protocol RybnAPI: Sendable { func me() async throws -> Me }
public struct APIClient: RybnAPI {
  public init(baseURL: URL, appBuild: String, tokens: any AccessTokenProvider, transport: any HTTPTransport = URLSessionTransport())
}
```

`APIError.message`: `unauthorized` → `Please sign in again.`; `upgradeRequired` → `This version of Rybn is out of date. Please update it.`; `network` → `Can't reach Rybn. Check your connection and try again.`; `decoding` → `Rybn sent something this version of the app doesn't understand.`; the rest carry the server's message, falling back to `Something went wrong. Please try again.`

- [ ] **Step 1: Write `ModelsTests.swift`:**
  - `decodesTheMeFixture`: id `user_2abcDEF`, username `sam`, displayName `Sam Rivera`, email `sam@example.com`, `avatarURL` `https://img.clerk.com/abc`.
  - `decodesAProfileWithNothingOptional`: `{"user":{"id":"u","username":null,"displayName":null,"email":null,"avatarUrl":null}}` decodes; `name` is `"there"`; `avatarURL` is nil.
  - `nameFallsBackToUsername`: displayName nil or `"  "`, username `sam` gives `"sam"`.
  - `aBadPictureAddressStillDecodes`: `avatarUrl` of `"not a url"` and of `"javascript:alert(1)"` decode, with `avatarURL` nil. (Review Focus 5.)
- [ ] **Step 2: Write `APIClientTests.swift`,** with `FakeTokens` and `FakeTransport` ported from Wilde:
  - `sendsTheTokenAndBuild`: `GET http://localhost:3000/api/mobile/v1/me` with `Authorization: Bearer token-1`, `X-App-Build: 7`, `Accept: application/json`.
  - `refreshesOnceOnA401AndRetries`: first reply 401 with the error fixture, second 200 with the me fixture; result is the fixture's `Me`; `tokens.refreshes == 1`; second request carries `Bearer token-2`.
  - `aSecond401EndsTheSession`: throws `.unauthorized`; exactly two requests.
  - `a401ThatIsNotTheAPIsOwnIsAServerError`: 401 with body `<html>Authentication Required</html>` twice throws `.server`, not `.unauthorized`. (Review Focus 1.)
  - `a426MeansUpdate`: throws `.upgradeRequired`.
  - `a422CarriesTheServersWords`: envelope `{code:"invalid", message:"page: too small"}` throws `.invalid("page: too small")`.
  - `a404CarriesTheServersWords`: code `not_found` throws `.notFound(...)`.
  - `a500WithNoEnvelopeUsesTheFallback`.
  - `aTransportFailureIsANetworkError`: transport throws `URLError(.notConnectedToInternet)`; throws `.network`.
  - `noNetworkWhileFetchingATokenIsNotASignOut`: `FakeTokens(accessError: URLError(.notConnectedToInternet))` throws `.network`; nothing is sent. (Review Focus 2.)
  - `noSessionMeansUnauthorized`: `FakeTokens(token: nil)` throws `.unauthorized`.
  - `anAnswerItCannotReadIsADecodingError`: 200 with `{}`.
- [ ] **Step 3: Run `swift test`.** Expected: fails to compile.
- [ ] **Step 4: Implement `Models.swift`, `APIError.swift`, `APIClient.swift`.** `APIError.check` treats 401 as `.unauthorized` and 404 as `.notFound` only when the envelope's `code` says so.
- [ ] **Step 5: Run `swift test`.** Expected: pass.
- [ ] **Step 6: Commit.** `git add -A && git commit -m "Talk to the website: API client, errors and the signed-in person"`

### Task 6: The session

**Files:**
- Create: `Packages/RybnKit/Sources/RybnKit/AppSession.swift`
- Modify: `Tests/RybnKitTests/Fakes.swift` (add `FakeAuth`, `FakeAPI`)
- Test: `Tests/RybnKitTests/AppSessionTests.swift`
- Port from: `wpfc-mobile/Packages/WPFCKit/Sources/WPFCKit/AppSession.swift`, `Tests/WPFCKitTests/AppSessionTests.swift`

**Interfaces:**
- Consumes: `RybnAPI`, `Me`, `APIError` (Task 5).
- Produces:

```swift
public protocol AuthService: Sendable {
  /// Whether this phone holds a signed-in session, once the sign-in library has finished restoring it.
  func hasSession() async -> Bool
  /// Ends this phone's session only.
  func signOut() async
}

@MainActor @Observable
public final class AppSession {
  public enum State: Equatable, Sendable {
    case launching, signedOut(message: String?), signedIn(Me), updateRequired, unreachable
  }
  public static let sessionEndedMessage = "Your session ended. Please sign in again."
  public private(set) var state: State   // starts .launching
  public private(set) var isSigningOut: Bool
  public init(auth: any AuthService, api: any RybnAPI)
  public var me: Me? { get }
  public func start() async           // at launch
  public func refresh() async         // on return to the foreground, and "Try again"
  public func signedIn() async        // the sign-in sheet finished: load /me
  public func signOut() async
  public func handle(_ error: any Error) async  // screens pass API errors here
}
```

Differences from Wilde's: no `signIn(email:password:)` (Clerk's sheet signs in, then the app calls `signedIn()`); no device token; no `forbidden` case. The `generation` counter and its guards stay exactly as Wilde's.

- [ ] **Step 1: Write `AppSessionTests.swift`:**
  - `startWithNoSessionShowsWelcome`: `.signedOut(message: nil)`; `/me` never called.
  - `startWithASessionLoadsThePerson`: `.signedIn(me)`.
  - `startWhenTheServerSaysSignedOut`: `/me` throws `.unauthorized`; `auth.signOut` called once; `.signedOut(message: AppSession.sessionEndedMessage)`.
  - `startWithNoNetworkIsUnreachableNotSignedOut`: `/me` throws `.network`; `.unreachable`; `auth.signOut` not called. (Review Focus 2.)
  - `startOnAnOldBuild`: `.upgradeRequired` gives `.updateRequired`.
  - `refreshKeepsThePersonThroughABlip`: signed in, `/me` throws `.network`; still `.signedIn`.
  - `refreshRecoversFromUnreachable`.
  - `refreshDoesNothingWhenSignedOut`: `/me` not called.
  - `signedInLoadsThePerson`; `signedInWithNoNetworkIsUnreachable`; `signedInWhenTheServerRefuses` (signs out, session-ended message).
  - `signOutEndsThePhonesSession`: `auth.signOut` called; `.signedOut(message: nil)`.
  - `aLateAnswerAfterSignOutIsIgnored`: start a `refresh()` whose `/me` is held open, `signOut()`, release the reply; state stays `.signedOut(message: nil)`. (Review Focus 4.)
  - `aLateAnswerForTheLastPersonIsIgnored`: the same, with `signedIn()` for a second person in between; state is the second person.
  - `handleUnauthorizedWhileSignedIn`: signs out with the session-ended message.
  - `handleUnauthorizedWhileSignedOutChangesNothing`.
  - `handleUpgradeRequired`: `.updateRequired`.
- [ ] **Step 2: Run `swift test` (fails), implement `AppSession`, run it (passes).**
- [ ] **Step 3: Commit.** `Decide which screen shows: the app session`

### Task 7: The look: palette, type, kit and tabs

**Files:**
- Create: `Packages/RybnKit/Sources/RybnKit/Palette.swift`, `Contrast.swift`, `Tabs.swift`, `Initials.swift`, `Greeting.swift`; `Rybn/Kit/Theme.swift`, `Card.swift`, `HeroCard.swift`, `Buttons.swift`, `Rows.swift`, `Chip.swift`, `Avatar.swift`, `EmptyState.swift`; `Rybn/Fonts/` (Quicksand, Lora, `OFL.txt`)
- Modify: `Rybn/Info.plist` (`UIAppFonts`), `Rybn/Assets.xcassets` (AccentColor, launch colour)
- Test: `Tests/RybnKitTests/PaletteTests.swift`, `TabsTests.swift`, `InitialsTests.swift`, `GreetingTests.swift`
- Port from: `wpfc-mobile/Packages/WPFCKit/Sources/WPFCKit/Palette.swift`, `Contrast.swift`, `Tabs.swift`, `Tests/WPFCKitTests/PaletteTests.swift`; `wpfc-mobile/WPFC/Kit/`

**Interfaces:**
- Produces:

```swift
// Palette.swift: one static per token in rybn/app/globals.css :root, camelCase, light values only.
public struct RGB: Equatable, Sendable { public let r, g, b: UInt8 }
public enum Palette {
  public static let ground, surface, surfaceHover, line, fillMuted, ink, inkSoft, inkMuted: RGB
  public static let primary, primaryHover, primary50, primary100, primary200, primary600, primary700: RGB
  public static let accent, accentHover, accentInk, tintAccent: RGB
  public static let gold, goldInk, tintGold: RGB
  public static let heroInk, heroInkSoft, controlLine: RGB
  public static let success, successTint, error, errorTint, warning, warningTint: RGB
}
public func contrastRatio(_ a: RGB, _ b: RGB) -> Double

// Tabs.swift
public struct TabDefinition: Identifiable, Hashable, Sendable { public let id, title, systemImage: String }
// .home ("home", "Home", "house"), .groups ("groups", "Groups", "person.2"),
// .gifts ("gifts", "Gifts", "shippingbox"), .wishlist ("wishlist", "Wishlist", "list.bullet"),
// .account ("account", "Account", "person.crop.circle")
extension TabDefinition { public static let all: [TabDefinition]; public static let shipped: Set<String> }
public func visibleTabs(from definitions: [TabDefinition] = TabDefinition.all) -> [TabDefinition]

// Initials.swift and Greeting.swift
public func initials(for name: String) -> String
public func greeting(at date: Date, calendar: Calendar = .current) -> String
```

Values are the RGB triples in `rybn/app/globals.css`, for example `ground` 250 246 239, `ink` 31 42 36, `primary` 20 67 42, `accent` 159 18 57, `heroInk` 243 237 226. Take every one from the file.

The kit, in SwiftUI under `Rybn/Kit/`: `Theme` (colours from `Palette`; `Font.rybnBody` Quicksand, `Font.rybnHeading` Lora, both scaling with Dynamic Type), `Card`, `HeroCard` (evergreen ground, `heroInk` text), `PrimaryButtonStyle` (cranberry ground, `accentInk` text), `SecondaryButtonStyle`, `Row`, `Chip`, `Avatar(url:name:size:)` with the initials fallback, `EmptyState`. Every tappable thing is at least 44 points tall.

- [ ] **Step 1: Write the four test files:**
  - `PaletteTests.textMeetsFourPointFiveToOne`: each of these pairs is at least 4.5: `ink`/`ground`, `ink`/`surface`, `inkSoft`/`ground`, `inkSoft`/`surface`, `inkMuted`/`ground`, `heroInk`/`primary`, `heroInkSoft`/`primary`, `accentInk`/`accent`, `accent`/`ground`, `accent`/`tintAccent`, `primary`/`ground`, `primary`/`primary50`, `goldInk`/`tintGold`, `error`/`errorTint`, `success`/`successTint`, `warning`/`warningTint`.
  - `PaletteTests.controlsMeetThreeToOne`: `controlLine`/`surface` is at least 3.
  - `PaletteTests.matchesTheWebsite`: `ground` is 250, 246, 239; `primary` is 20, 67, 42; `accent` is 159, 18, 57.
  - `TabsTests.allFiveInOrder`: ids are `home, groups, gifts, wishlist, account`.
  - `TabsTests.thisBuildShowsHomeAndAccount`: `visibleTabs()` ids are `home, account`.
  - `InitialsTests`: `"Sam Rivera"` → `SR`; `"sam"` → `S`; `"Grandma June"` → `GJ`; `"  "` and `""` → `?`; `"mary-jane o'neil"` → `MO`; three words take the first and last. (Review Focus 3.)
  - `GreetingTests`: 00:00 and 11:59 → `Good morning`; 12:00 and 17:59 → `Good afternoon`; 18:00 and 23:59 → `Good evening`. These are the site's hours (`components/layout/HeroBanner.tsx`).
- [ ] **Step 2: Run `swift test` (fails), implement the five RybnKit files, run it (passes).** A failing contrast pair is a finding to report, not a number to adjust.
- [ ] **Step 3 [Kason]: Fonts.** Ask before downloading. Wanted: Quicksand (400, 500, 600, 700) and Lora (500, 600) as TTF with their `OFL.txt`, from `github.com/google/fonts` under `ofl/quicksand` and `ofl/lora`. Add them under `Rybn/Fonts/` and list them in `UIAppFonts`.
- [ ] **Step 4: Write the kit views.** Run `xcodegen generate` and the `xcodebuild test` command. Expected: builds, `testAppLaunches` passes.
- [ ] **Step 5: Commit.** `Give the app Rybn's look: palette, type, kit and tabs`

### Task 8: Sign-in

**Files:**
- Create: `Rybn/App/ClerkAuthService.swift`, `Services.swift`, `Environment.swift`, `RootView.swift`; `Rybn/Features/Welcome/WelcomeView.swift`; `Rybn/Features/Common/StatusViews.swift`
- Modify: `project.yml` (the Clerk package and both products), `Rybn/Info.plist` (a URL type whose scheme is `app.rybn.ios`), `Rybn/App/RybnApp.swift`, `RybnUITests/LaunchTests.swift`, `README.md`
- Port from: `wpfc-mobile/WPFC/App/SupabaseAuthService.swift` (the `tokenFailure` mapping), `Services.swift`, `Environment.swift`, `RootView.swift`, `WPFCApp.swift`; `WPFC/Features/Common/StatusViews.swift`

**Interfaces:**
- Consumes: `AuthService`, `AccessTokenProvider`, `AppSession`, `APIClient`, `AppConfig`, the kit.
- Produces:

```swift
struct ClerkAuthService: AuthService, AccessTokenProvider   // wraps Clerk.shared; the only file that calls Clerk for auth
@MainActor final class Services {
  let config: AppConfig
  let session: AppSession
  static func make() -> Services
  func launch() async        // session.start()
  func becameActive() async  // session.refresh()
}
```

Words and identifiers on Welcome: wordmark `Rybn`; tagline `Tied together`; button `Sign in` (identifier `welcome.signIn`); link `New to Rybn? Create your account at rybn.app` (identifier `welcome.createAccount`, opens `config.registerURL` in Safari); links `Privacy Policy` and `Terms of Service`; the sign-out message when there is one. The two legal links are a small addition to §5.5, as Wilde's sign-in has them.

Status screens: `LaunchingView`; `UnreachableView` with heading `Can't reach Rybn` and button `Try again` calling `session.refresh()`; `UpdateRequiredView` with heading `Update required`, body `This version of Rybn is out of date. Please update it.`, and an `Update` button only when `config.updateURL` is set.

- [ ] **Step 1: Add the package and read it.** Add clerk-ios to `project.yml`, run `xcodegen generate`, resolve packages, then read the checked-out source. Write what you find under "Clerk notes" in `README.md`, each with its file:
  - how to wait until Clerk has finished restoring a stored session;
  - `getToken`'s full signature, and whether it can be told to skip its cache;
  - what `signOut()` ends;
  - `AuthView`'s initializers (the design expects `AuthView(mode: .signIn)`);
  - how `\.clerkTheme` is set, and what it can change;
  - how an OAuth callback URL is handed back (`.onOpenURL` and `clerk.handle`).

  If `mode: .signIn` does not exist in the installed version, stop and report: D3 depends on it.
- [ ] **Step 2 [Kason]: Clerk Dashboard, development instance.** Native applications page: enable the Native API, and add the iOS app with the Apple team ID and bundle ID `app.rybn.ios`.
- [ ] **Step 3: Write `ClerkAuthService`.** `hasSession()` waits for Clerk to finish restoring, then answers whether there is a signed-in user. `accessToken()` is `clerk.auth.getToken()`; nil means no session. `refreshedAccessToken()` skips the cache if step 1 found a way, else calls it again. A `URLError` becomes `APIError.network`; a cancelled task becomes `APIError.network("cancelled")`; nothing here may turn a network failure into "no session".
- [ ] **Step 4: Write `Services`, `Environment`, `RybnApp`, `RootView`, `WelcomeView`, `StatusViews`.** `RybnApp` calls `Clerk.configure(publishableKey:)` in its initializer, puts `Clerk.shared` in the environment, routes opened URLs to Clerk, forces `.preferredColorScheme(.light)` at the root, runs `services.launch()` once and `services.becameActive()` when the scene becomes active. In debug builds only, the launch argument `-resetSession` signs Clerk out before `launch()`, so UI tests start signed out. `RootView` switches on `session.state`; for `.signedIn` it shows `Text(me.user.name)` until Task 9. Welcome presents `AuthView(mode: .signIn)` in a sheet, themed from `Palette`; when Clerk reports a user while the session is signed out, call `session.signedIn()` and dismiss.
- [ ] **Step 5: Replace `testAppLaunches` with `testLaunchShowsWelcome`:** launch with `-resetSession` (which signs Clerk out at launch, debug builds only); `app.buttons["welcome.signIn"]` exists within 15 seconds; `app.staticTexts["Tied together"]` exists; the three links each have a frame at least 44 points tall.
- [ ] **Step 6: Run `xcodegen generate` and the `xcodebuild test` command.** Expected: `** TEST SUCCEEDED **`.
- [ ] **Step 7 [Kason]: Sign in for real.** With rybn's dev server running, on the iPhone 17 simulator: sign in by email and password, and separately with Google. Each lands on the signed-in placeholder showing the right name. Quit and relaunch: still signed in. If the sheet cannot be made to look like Rybn, say so before going on (D3's fallback).
- [ ] **Step 8: Commit.** `Sign in with a rybn.app account`

### Task 9: Home, Account and the tab bar

**Files:**
- Create: `Rybn/App/MainTabView.swift`, `Rybn/Features/Home/HomeView.swift`, `Rybn/Features/Account/AccountView.swift`
- Modify: `Rybn/App/RootView.swift`
- Port from: `wpfc-mobile/WPFC/App/MainTabView.swift`, `WPFC/Features/Account/AccountView.swift`

**Interfaces:**
- Consumes: `visibleTabs()`, `greeting(at:)`, `initials(for:)`, `RybnUser.name`, `AppConfig`, `AppSession.signOut()`, the kit.
- Produces: `MainTabView(me: Me)`, shown by `RootView` for `.signedIn`.

Home: a `HeroCard` with the greeting on one line and `me.user.name` beneath it in Lora; under it a `Card` reading `Wishlists and gifts arrive in the next builds. Until then, everything is at rybn.app.` with a button `Open rybn.app` (opens `config.apiBaseURL`).

Account: `Avatar`, `me.user.name`, `@username` when there is one, email when there is one; rows `Edit profile` (opens `config.editProfileURL`), `Password and security` (opens `AppConfig.accountPortalURL`), `Privacy Policy`; the line `Version <versionLabel>`; and `Sign out` (identifier `account.signOut`), which asks `Sign out of Rybn?` with `Sign out` and `Cancel` before calling `session.signOut()`.

- [ ] **Step 1: Write `MainTabView`, `HomeView`, `AccountView`;** point `RootView`'s signed-in case at `MainTabView`. The tab bar is built from `visibleTabs()`, so it shows Home and Account.
- [ ] **Step 2: Build and run the tests.** Expected: `** TEST SUCCEEDED **`. Screens get their own UI tests in Task 10, where sample data exists.
- [ ] **Step 3 [Kason]: Try it on the simulator** against the local site: Home greets by name; Account shows the account's details; each link opens the right page; Sign out returns to Welcome; and the browser tab signed in at `http://localhost:3000` is still signed in afterwards (§12 criterion 2).
- [ ] **Step 4: Commit.** `Home and Account, behind a tab bar`

### Task 10: Preview mode and screen tests

**Files:**
- Create: `Packages/RybnKit/Sources/RybnKit/Preview.swift`; `Rybn/Preview/KitGallery.swift`, `PreviewRouting.swift`; `scripts/build-preview.sh`, `scripts/preview-shots.sh`; `RybnUITests/PreviewSmokeTests.swift`
- Modify: `Rybn/App/Services.swift`, `Environment.swift`, `RootView.swift`, `README.md`
- Test: `Tests/RybnKitTests/PreviewTests.swift`
- Port from: `wpfc-mobile/Packages/WPFCKit/Sources/WPFCKit/Preview.swift` (`PreviewLaunch`, `PreviewAuth`, `PreviewAPI`, `PreviewData`), `WPFC/Preview/`, `scripts/build-preview.sh`, `preview-shots.sh`, `WPFCUITests/PreviewSmokeTests.swift`

**Interfaces:**
- Produces (all inside `#if DEBUG`; a Release build contains none of it):

```swift
public struct PreviewLaunch: Equatable, Sendable {
  public enum Screen: String, Sendable, CaseIterable { case home, account, welcome, launching, unreachable, update, kit }
  public let screen: Screen
  /// Nil unless "-designPreview" is among the arguments. "-previewScreen <name>" picks the screen; home otherwise.
  public init?(arguments: [String])
}
public final class PreviewAuth: AuthService { public init(signedIn: Bool) }
public final class PreviewAPI: RybnAPI { public init(launch: PreviewLaunch) }
public enum PreviewData { public static let me: Me }
```

`PreviewData.me`: id `user_preview`, username `sam`, displayName `Sam Rivera`, email `sam@example.com`, no picture. `PreviewAPI.me()` throws `.network` for `.unreachable`, `.upgradeRequired` for `.update`, and never answers for `.launching`. In preview mode `Services.make()` uses these and never touches Clerk or the network.

- [ ] **Step 1: Write `PreviewTests.swift`:** no `-designPreview` gives nil; `-designPreview` alone gives `.home`; `-designPreview -previewScreen account` gives `.account`; an unknown screen name gives `.home`; `PreviewAPI` for `.home` answers `PreviewData.me`; for `.unreachable` it throws `.network`; for `.update` it throws `.upgradeRequired`.
- [ ] **Step 2: Run `swift test` (fails), implement `Preview.swift`, run it (passes).**
- [ ] **Step 3: Wire it in:** the preview branch in `Services.make()`, the `previewLaunch` environment value, `KitGallery` (every kit component once, under the heading `Kit`), and `RootView` showing the gallery for `.kit`.
- [ ] **Step 4: Write `PreviewSmokeTests.swift`,** one test per screen, launching with `-designPreview -previewScreen <name>`:
  - `home`: a static text containing `Sam Rivera`; the text `Open rybn.app`; the tab bar has exactly `Home` and `Account`.
  - `account`: `@sam`, `sam@example.com`, a text starting `Version `, `app.buttons["account.signOut"]`; an avatar reading `SR`. (Review Focus 3.)
  - `welcome`: `app.buttons["welcome.signIn"]`.
  - `launching`: neither Welcome nor the tab bar is on screen.
  - `unreachable`: `Can't reach Rybn` and a `Try again` button.
  - `update`: `Update required`.
  - `kit`: `Kit`.
- [ ] **Step 5: Run the `xcodebuild test` command.** Expected: `** TEST SUCCEEDED **`.
- [ ] **Step 6: Port the two scripts, document preview mode in `README.md`, and look at every screen.** `scripts/preview-shots.sh <udid> <dir>` screenshots each one; read the images and fix anything clipped, misaligned or off-palette.
- [ ] **Step 7: Commit.** `See any screen without an account: preview mode`

### Task 11: TestFlight

Everything here is §11. Most steps are Kason's, in Apple's and Clerk's dashboards and in Xcode. It starts only after Task 3's pull request is merged and `https://rybn.app/api/mobile/v1/me` answers 401 to `curl` with no token.

- [ ] **Step 1 [Kason]: The live Clerk key.** Put the production `pk_live_` publishable key in `Release.xcconfig` as `CLERK_PUBLISHABLE_KEY`.
- [ ] **Step 2 [Kason]: Clerk Dashboard, production instance.** Enable the Native API and add the iOS app (team ID, `app.rybn.ios`), as in Task 8 step 2.
- [ ] **Step 3: App icon and launch mark** from `rybn/app/icon.svg` and `rybn/public/brand/`, by a script on the lines of `wpfc-mobile/scripts/make-app-icon.swift`. Run the tests; commit.
- [ ] **Step 4 [Kason]: Apple.** An App ID for `app.rybn.ios` in the Developer portal; an app record named `Rybn` in App Store Connect; automatic signing in Xcode with the team from `Shared.xcconfig`. Associated Domains (§7) is optional and off unless password AutoFill is wanted; sign-in works without it.
- [ ] **Step 5 [Kason]: Upload build 1.** Any iOS Device, Product → Archive, Distribute App → App Store Connect → Upload.
- [ ] **Step 6 [Kason]: Internal test on a real phone, against production** (§9 manual step 3): install from TestFlight; sign in by email and by Google; the right name and picture show; quit and relaunch, still signed in; sign out; the browser session on rybn.app is still signed in.
- [ ] **Step 7 [Kason]: Family.** Create an external tester group; give Beta App Review a demo account with a password and one line saying what Rybn is; privacy policy `https://rybn.app/privacy`. Once approved, set `UPDATE_URL` in `Shared.xcconfig` to the TestFlight public link.
- [ ] **Step 8: Finish `README.md`'s Releasing section** as wpfc-mobile's: bump `CURRENT_PROJECT_VERSION`, `xcodegen generate`, commit, Archive, Upload. Commit.

## Done when

The six criteria in §12 hold: a family member installs, signs in, sees their name and picture, stays signed in and can sign out; signing out of the app leaves the browser signed in; `/me` answers a bearer token under RLS with `require-auth.ts` untouched and answers no token with the 401 envelope; the site's gates hold; Debug reaches the local site and Release reaches `https://rybn.app`; preview mode shows every screen with no network.
