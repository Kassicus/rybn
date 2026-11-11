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

## Mobile API

The native iPhone app talks to the site only through `app/api/mobile/v1/`. Every route there is built with `mobileRoute` from `lib/mobile/route-live.ts`.

- Build every route with `mobileRoute`, so the build gate, sign-in check, parsing and error shape come for free.
- The API is bearer-only. A browser cookie is never accepted, so every request needs an `Authorization: Bearer` header.
- Never take a user id from the request. Use the `userId` the wrapper gives the handler.
- Choose the `user_profiles` columns you select deliberately, because row-level security lets a caller read their group-mates' rows.

`/api/mobile` is deliberately absent from `proxy.ts`'s protected list: the app needs a 401, not a redirect to the sign-in page.

| Route | Answers |
| --- | --- |
| `GET /me` | The signed-in person's profile. |
| `GET /wishlist` | `{ items }`, the caller's own wishlist. |
| `POST /wishlist` | `{ item }`, the new item (200). |
| `PUT /wishlist/{id}` | `{ item }`, the replaced item; 404 when it is not the caller's. |
| `DELETE /wishlist/{id}` | 204, also when the item is already gone or not the caller's. |
| `POST /wishlist/images` | `{ imagePath, imageUrl }` for a JPEG or PNG sent as raw bytes. |
| `GET /groups` | `{ groups }`, the groups the caller belongs to. |

- Requests are checked at the door (`lib/mobile/wishlist.ts`). A rule the person broke answers 422 with a sentence for them. An action's database error is logged and answered with the standard 500, never passed on.
- Items are built field by field (`mobileItem`). Never send a row: rows carry `purchased`, stock marks and the owner's id, and the owner must never learn an item was bought.
- Pictures are JPEG or PNG, at most 4 MB. They are stored in the caller's own folder with the caller's own client. An upload route's path must not end in an image extension, because `proxy.ts` skips those paths and `auth()` would then fail.

- A request whose path ends in an image extension (for example `/api/mobile/v1/wishlist/x.png`) is skipped by `proxy.ts`, so it answers 500 instead of 401. It exposes nothing, but it writes an error to the log. The fix belongs in the proxy's matcher.
- `PUT` replaces the whole item, privacy included. The app must send back every field it was given.
- An item can come back with `imageUrl` null and `imagePath` set, when the picture's address could not be signed. Keep sending `imagePath` back on an edit.
- A body larger than Vercel's own limit (about 4.5 MB) is refused by Vercel with its own error, before the route's size sentence.

`lib/mobile/fixtures/*.json` are the contract, including `wishlist.json`, `wishlist-item.json`, `groups.json` and `wishlist-item-request.json`. They are copied into `rybn-mobile/Packages/RybnKit/Tests/RybnKitTests/Fixtures/`, so change both together.

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
- **Lora + Quicksand** - display and body faces
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

A UI/UX overhaul is the current focus. The palette is Evergreen & Cranberry,
defined once in `app/globals.css` as CSS variables and consumed through
`tailwind.config.ts`; every colour pair in it is checked against WCAG rather
than chosen by eye.

**Light only, deliberately.** A dark theme was built and removed: the design
leans on a deep evergreen hero that works because it reads dark-on-cream, and
dark has no equivalent move -- the same block on a dark ground is just a slab.
Re-adding it later means a `.dark { }` block and a provider, but it needs a
dark *design* first, not a recolour of this one. The feature surface above is largely in
place; the interface is what needs work.

Known outstanding items:

- ~66 ESLint findings remain, mostly `@typescript-eslint/no-explicit-any`,
  plus five `<img>` tags that should become `next/image`
- `getPrivacyDescription()` in `lib/utils/privacy.ts` ignores per-group
  overrides, so the summary it renders can understate how restricted a field is

`_planning/` holds the original phase plan and the design and implementation
documents for the Clerk migration and link-metadata work.

## License

MIT
