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

The native iPhone app talks to the site only through `app/api/mobile/v1/`. Every route there is built with `mobileRoute` from `lib/mobile/route-live.ts`, except `DELETE /me`, which is built with `mobileRouteWithoutProfile` from `lib/mobile/route-no-profile.ts` and makes no profile.

- Build every route with `mobileRoute`, so the build gate, sign-in check, parsing and error shape come for free. The one exception is `DELETE /me`: `mobileRouteWithoutProfile` gives it the same, but knows the caller from the token alone and never makes a profile.
- The API is bearer-only. A browser cookie is never accepted, so every request needs an `Authorization: Bearer` header.
- Never take a user id from the request. Use the `userId` the wrapper gives the handler.
- Choose the `user_profiles` columns you select deliberately, because row-level security lets a caller read their group-mates' rows.

`/api/mobile` is deliberately absent from `proxy.ts`'s protected list: the app needs a 401, not a redirect to the sign-in page.

| Route | Answers |
| --- | --- |
| `GET /me` | The signed-in person's profile. |
| `GET /profile` | `{ profile }`: `username`, `displayName`, `bio`, `avatarUrl`, `limits`, `sections` (every field the website knows, each with what the caller saved in it, `value` null where empty), `visibleTo` and `mixed`. A field's `max` and the `limits` count UTF-16 code units of the trimmed text, as JavaScript counts a string's length, not characters as a person sees them. |
| `PUT /profile` | `{ profile }`, read again after the save; body `{ username, displayName, bio, fields }`. 422 with the plain sentence for a JSON body of another shape, the website form's sentence for anything the form refuses, and `Username is already taken`; a body that is not JSON answers `body: must be JSON`, as on every route. A control character answers `That has characters Rybn can't save. Try typing it again.`; the bio, `hobbies`, `interests` and `dislikes` may hold a tab, a line feed and a carriage return. |
| `PUT /profile/visibility` | `{ visibleTo }`; body `{ visibleTo }`, any of `family`, `friends`, `work` and `custom`, none for only the caller. 422 `Choose which kinds of group can see your details.` for any other JSON body; a body that is not JSON answers `body: must be JSON`, as on every route. |
| `GET /wishlist` | `{ items }`, the caller's own wishlist. |
| `POST /wishlist` | `{ item }`, the new item (200). |
| `PUT /wishlist/{id}` | `{ item }`, the replaced item; 404 when it is not the caller's. |
| `DELETE /wishlist/{id}` | 204, also when the item is already gone or not the caller's. |
| `GET /wishlist/occasions` | `{ occasions }`, what the caller may tag one of their own items for now, soonest first: their own birthday and anniversary (titled `Your birthday` and `Your anniversary`) and their groups' dates. |
| `POST /wishlist/images` | `{ imagePath, imageUrl }` for a JPEG or PNG sent as raw bytes. |
| `GET /groups` | `{ groups }`, the groups the caller belongs to, each with a `memberCount`. |
| `POST /groups` | `{ group }` with `memberCount`; body `{ name, description, type }` (`description` may be null or left out). The name and the description are tidied first: made one line, characters that cannot be seen made spaces, then trimmed. Then the name is 1 to 50 and the description at most 200 UTF-16 code units of the tidied text, as JavaScript counts a string's length, not characters as a person sees them; type is one of the four (`lib/schemas/groups.ts`). 422 with the plain sentence for a JSON body of another shape, and the website's sentence for a name, description or type it refuses; a body that is not JSON answers `body: must be JSON`, as on every route. |
| `POST /groups/join` | `{ group }`; body `{ code }`, tidied as the website's form tidies it. 422 with the website's sentence for a bad code (one longer than 64 characters included), a second join, or an account still being set up. |
| `GET /home` | `{ occasions }`, a year ahead, not the caller's own birthday, each with the people to shop for and the caller's gift count for each. |
| `GET /groups/{id}` | `{ group, members, occasions }`, with `group.description`, `group.role` (the caller's) and each member's `role` (`owner`, `admin` or `member`); each occasion's `change` is `{ id }` for a group date the caller may change (its maker, or an owner or admin), else null; 404 when the caller is not in it. |
| `DELETE /groups/{id}` | 204; 422 for anyone but the owner; 404 when the caller is not in it. |
| `GET /groups/{id}/invite` | `{ code }`, to members only; 404 when the caller is not in it. |
| `POST /groups/{id}/invitations` | `{ sent, resent, message }`; body `{ email }`. 404 when the caller is not in it; 422 with the website's sentence for a bad address (one longer than 254 characters once trimmed included), the hourly limit, someone already in the group, or an address another member invited that has not accepted (`Someone in this group has already invited this address.`). |
| `DELETE /groups/{id}/membership` | 204; 422 for the owner; 404 when the caller is not in it. |
| `POST /groups/{id}/dates` | `{ occasion }`, the new date's `occasion` as each entry of `GET /groups/{id}` carries it; body `{ name, date }`. 404 when the caller is not in the group; 422 with the website's sentence for a name or a date it refuses. |
| `PUT /groups/{id}/dates/{dateId}` | `{ occasion }`; body `{ name, date }`. 404 for a date that is not there, not in that group, or not the caller's to change; 422 as for `POST`. |
| `DELETE /groups/{id}/dates/{dateId}` | 204; 404 for a date that is not there, not in that group, or not the caller's to change. It also removes every item's tag for that date, and claims and gifts filed under it are left with no occasion, as the website's delete does. |
| `GET /people/{id}/wishlist?occasion=<key>` | `{ person, occasion, occasions, gifts, items }`; the caller's own list answers items alone. |
| `GET /people/{id}/profile` | `{ person, bio, sections, sharedGroups }`: only the fields the caller may see that hold something (a section with none is left out), and the groups the two share. 404 with no group in common, as for someone who is not there. The caller's own id answers 404 too: their own profile is `GET /profile`. |
| `POST /wishlist/{id}/claim` | `{ gift }`, body `{ occasion }` (a key or null). A second POST by the person who already holds the item answers their gift again (it does not claim twice). |
| `DELETE /wishlist/{id}/claim` | 204; 422 once the item is bought or its gift is past Claimed. |
| `GET /gifts?season=<year>` | `{ season, seasons, counts, totals, groups, choices }`. `totals` is `{ spent, planned, gifts, people, finished }` for the season shown, over the gifts `counts` counts: `spent` is the prices of gifts at Ordered, Arrived, Wrapped and Given, `planned` at Claimed and Planned (a gift with no price adds 0), `gifts` is how many, `people` how many headings, and `finished` how many are at Wrapped or Given. Each heading in `groups` has `key` (`person:<id>` or `recipient:<id>`), `spent` and `notes` (a string, or null when there are none). |
| `GET /gifts/{id}` | `{ gift, occasions }`. |
| `POST /gifts` and `PUT /gifts/{id}` | `{ gift }`. `PUT` replaces the whole gift, as the wishlist's does, so the app sends back every field it was given. Saving a different occasion on a gift from a list moves its claim to that occasion too. |
| `POST /gifts/{id}/step` | Body `{ direction, from }`: `{ gift }`. `from` is the stage the app is showing; the gift moves only if it is still at that stage, and otherwise the answer is the gift as it is, so a retry or a second tap never moves it twice. Stepping a gift from a list from Claimed to Ordered marks the item bought on its owner's list, and stepping it back un-marks it. |
| `DELETE /gifts/{id}` | 204; 422 while its claim is held, except as below for an item that can no longer be seen. |
| `POST /gifts/images` | As `/wishlist/images`, in `gift-photos`. |
| `PUT /gifts/notes` | 204; body `{ key, notes, name }`. A `recipient:` key saves the caller's typed row's name (required) and notes; a `person:` key saves notes on the caller's row tied to that person, making the row when there is none, and refuses a `name` (422). The name is saved trimmed. A control character in the name once trimmed, or in the notes (which may hold a tab, a line feed and a carriage return), answers 422 `That has characters Rybn can't save. Try typing it again.`, as on `POST /gifts`. The website's rules (`recipientSchema`: name 1 to 100, notes up to 500) answer 422 with its sentences, and so does `You already have a recipient with this name`. A key that names no heading, a row that is not the caller's, the caller's own id, and a person the caller neither shares a group with nor has a row for answer 404. `""` clears the notes. |
| `DELETE /me` | 204: deletes the caller's account, in this order: their pictures, the account in the database (`delete_account()`), an email telling them so (only when their profile had an address; a failed email does not fail the deletion), the sign-in account, then `delete_account()` once more, so that nothing made for them while the deletion ran stays (a failure of this last step is logged and does not fail the deletion). A second call after a failure finishes what is left. 500 on a failure. Built with `mobileRouteWithoutProfile` (`lib/mobile/route-no-profile.ts`): the same checks, but the caller is known from the token alone, so it never makes a profile. |
| `POST /wishlist/{id}/out-of-stock` and `DELETE /wishlist/{id}/out-of-stock` | 204: mark and clear the mark, as the website's buttons do. 404 `That isn't there any more.` for the caller's own item, one they cannot see, one that is gone, or an id that is not a UUID. No answer says who marked it. |
| `POST /profile/picture` | 200 `{ avatarUrl }` for a JPEG or PNG sent as raw bytes, as `/wishlist/images` (its checks and sentences, 422 before anything changes); set on the sign-in account first, then written to `avatar_url`. |
| `DELETE /profile/picture` | 204, removed from the sign-in account first, then `avatar_url` cleared. A failure of either step answers 500, and sending again puts it right. |
| `POST /invitations/accept` | 200 `{ group }`, as `POST /groups/join`; body `{ token }`, 64 characters of `0-9a-f`, or 422 `This invitation is invalid or has expired` before the website's action is called. The action's two sentences answer 422: `This invitation is invalid or has expired` and `Your account is still being set up. Please try again.` |

- Requests are checked at the door (`lib/mobile/wishlist.ts`). A rule the person broke answers 422 with a sentence for them. An action's database error is logged and answered with the standard 500, never passed on.
- Items are built field by field (`mobileItem`). Never send a row: rows carry `purchased`, stock marks and the owner's id, and the owner must never learn an item was bought.
- Pictures are JPEG or PNG, at most 4 MB. They are stored in the caller's own folder with the caller's own client. An upload route's path must not end in an image extension, because `proxy.ts` skips those paths and `auth()` would then fail.

- A request whose path ends in an image extension (for example `/api/mobile/v1/wishlist/x.png`) is skipped by `proxy.ts`, so it answers 500 instead of 401. It exposes nothing, but it writes an error to the log. The fix belongs in the proxy's matcher.
- `PUT` replaces the whole item, privacy included. The app must send back every field it was given.
- An item carries `occasions`: every occasion it is tagged for, soonest first, including one whose date has passed (a tag whose date the caller can no longer see, such as one of a group they left, is not listed). `POST` and `PUT` take an optional `occasions`, a list of at most 200 keys, of which at most 20 may be new to the item; the tags it already has are not counted. Sent, the item ends up tagged for exactly those, plus any tag it does not list, which a save never removes; the owner can remove it on the website. A key it is already tagged for is kept, even once its date has passed, and any other must be one of `GET /wishlist/occasions`, or the answer is 422 before anything is written. Tags are written with the website's own actions after the item; one that cannot be written then is logged, and the answer's `occasions` says what stands.
- A body without `occasions`, or with `occasions: null`, leaves the item's tags exactly as they are. Builds of the app that do not send it must never clear tags set on the website.
- `GET /wishlist` and `PUT` answer 500 when their items' tags cannot be read, and `GET /wishlist`, `PUT` and `POST` answer 500 when the dates cannot be read but are needed, which is only when an item carries a tag, a `PUT` body has `occasions`, or a `POST` body's `occasions` is not empty; a save that answers 500 writes nothing.
- An item can come back with `imageUrl` null and `imagePath` set, when the picture's address could not be signed. Keep sending `imagePath` back on an edit.
- A body larger than Vercel's own limit (about 4.5 MB) is refused by Vercel with its own error, before the route's size sentence.

- Every route that shows gifts first runs the reconciling step (`lib/mobile/reconcile.ts`). It files the caller's claims, made in the app or on the site, as gifts: under the claim's occasion, and at Ordered if the item is already bought. A gift the person had already added by hand is linked instead of duplicated only when it is not archived and not yet given, has exactly the item's name, is not filed under someone else, and either has exactly the item's link or, when neither has a link, is filed under the item's owner. It moves a gift at Claimed to Ordered when its item was marked bought while its claim is held, and brings a gift's occasion into step with its claim's. It is safe to repeat and touches only the caller's own gifts. A claim whose data cannot be filed is logged and skipped so the rest still load, and the two unique indexes are its backstop when two screens run it at once.
- An occasion is sent with a `key`: `group_date:<id>`, or `birthday|anniversary:<person id>:<year>`, so it names a birthday before it has a row. The app sends the key back to claim or file a gift; the server checks that it is one of the occasions involving that person, and makes the row then.
- Claims are made with the database's own `claim_wishlist_item`, never `claimItem`, so a claim can be for a group date and its occasion comes from the item's owner. A gift's status is sent as `claimed` for `planned` on a gift from a list.
- A gift from a list whose item the caller can no longer see (the owner hid it from them, or they left the group, but did not delete it) is never stepped between Claimed and Ordered, because the item cannot be marked; past Claimed it can be deleted while its claim is held, and the claim stays as the record that the item was bought.
- A gift's `seasonYear` is the year of its occasion, else its stored season, which for a gift from a list whose claim has no occasion is the year the claim was made (when it is filed, claimed again or moved to No occasion), and for a hand-added gift with no occasion, the year it was added.
- Owner-blindness: Home, groups and a person's list never read claims on the caller's own items; the caller's own list answers with no claim state. Never send `claimedBy`, `out_of_stock_marked_by` or an email.
- A group's invite code lets anyone holding it join. It is answered by `GET /groups/{id}/invite` to the group's members, and is never part of a list or a page.
- An invitation's group name is read on the server, never taken from the request; the answer never holds the invitation's token.
- A group date: name tidied as a group's name is (made one line, characters that cannot be seen made spaces, then trimmed), then 1 to 200 UTF-16 code units of the tidied text, as JavaScript counts a string's length; date `YYYY-MM-DD` and a real day. A date that is not there, or not the caller's to change, answers 404. Who may change or delete one is the database's rule (its maker, or an owner or admin of the group, while still in it); the routes ask the website's actions and never rely on the page's `change`, which follows the same rule.
- The migration `20261111000000_shopping_links.sql` must be applied before these routes are merged (`npx supabase db push`).
- The profile form is described by the website (`lib/profile/fields.ts`): every field it knows, in order, with its label, its kind (`text` or `date`) and the most it takes, counted in UTF-16 code units of the trimmed text (what JavaScript's `length` counts; an emoji can be two or more). A field added there needs no new build of the app.
- `PUT /profile` sets every field named in `fields` and clears one sent as null or empty; a field not named is left alone, so the app sends only what the person changed. The username, display name and bio are always sent. The rules are the website form's (`profileEditSchema`), checked at the door and again by `updateProfile`.
- `visibleTo` is the person's stored choice (`profile_visibility`): none means only them, and a person who never chose has all four. `mixed` says some field has another setting. Only `PUT /profile/visibility` changes who sees a field: it stores the choice and writes it onto every field, as the Settings page does.
- Another person's profile is built field by field from what row-level security returns, with named columns: never a row, never an email.
- The migration `20261112000000_profile_visibility.sql` is applied (`npx supabase db push`) just before this code is merged, because the Settings page, the profile save and these routes all read it. Applying it, running `npm run test:rls`, merging and deploying are done in one sitting.
- The migration `20261112000001_profile_fields_take_the_stored_choice.sql` (a new profile field takes its owner's stored choice, whoever writes it) is applied only once the code that saves a choice with `set_profile_visibility` is live on rybn.app, and before the pull request that adds it is merged (`npx supabase db push`). That code writes a choice onto existing fields with an update; the code before it upserted every field, and this trigger would rewrite what such an upsert sends. So once it is applied, no copy of the site older than that code (a rollback, an old preview, a local server on an old branch) may run against this database until the trigger is taken off: `drop trigger if exists profile_field_takes_stored_choice on public.profile_info;`
- Adding a value to an enumerated field (a priority, a privacy kind, a gift's step) is a breaking change for v1, because the app decodes strictly.
- An invitation's token is checked at the door and never logged or answered, not even in a fault's text.
- `/.well-known/apple-app-site-association` (`app/.well-known/apple-app-site-association/route.ts`) names the app and the one path `/accept-invite`, as JSON, to anyone; `tsconfig.json` names its folder, since TypeScript's `**` skips folders starting with a dot.
- The migration `20261114000000_delete_account.sql` is applied (`npx supabase db push`) before this code is merged; the site before this code never calls the function. It loosens three foreign keys (an invitation goes with the person who sent it; a group gift for someone who has gone, and a gift exchange match to them, are left for no one), adds `delete_account()`, which a signed-in person can run only for themselves, and drops the policy that let a signed-in person delete their own `user_profiles` row directly, so a profile row is deleted only through `delete_account()`. Called again when nothing of the caller's is left, the function changes nothing, which is what lets `DELETE /me` call it once more at its end. If five new invite codes in a row are already in use, the whole deletion is undone and can be tried again. In order, the function does this:
  - It takes every group the caller is a member of, made, or made a group gift or a gift exchange in, and locks each one until it is done, so a join or another member's deletion waits. A group's heir is its first member other than the caller by role (owner, admin, member), then the longest standing: its owner, whenever it has one besides the caller. A group with no heir is deleted, with its dates, invitations, group gifts and exchanges. In a group with an heir:
    - where the caller was its owner, the heir becomes its owner;
    - where the caller was a member, the group gets a new invite code, as leaving a group does; a group the caller made, or made something in, but is not a member of keeps its code;
    - the heir is recorded as the maker of the group, where the caller made it, and of each gift exchange the caller made in it;
    - each group gift the caller made goes to its longest-standing contributor who is neither the caller nor the person it is for, and a gift with no such contributor is deleted, with its contributions and messages.
  - Each gift exchange the caller is in, or is someone's match in, that has not been held yet (its date is later than now, or it has none) has every match cleared, so it can be drawn again. One already held keeps its matches, except a match to the caller, which is cleared.
  - The caller's profile row is deleted, and the rest of their rows go by cascade: their claims are released, and an item they bought for someone stays bought.

`lib/mobile/fixtures/*.json` are the contract, including `wishlist.json`, `wishlist-item.json`, `wishlist-occasions.json`, `groups.json`, `wishlist-item-request.json`, `home.json`, `group-list.json`, `group.json`, `person-wishlist.json`, `gift.json`, `gifts.json`, `claim-request.json`, `gift-request.json`, `step-request.json`, `group-request.json`, `group-created.json`, `join-request.json`, `invite.json`, `invitation-request.json`, `invitation.json`, `group-date-request.json`, `group-date.json`, `profile.json`, `profile-request.json`, `visibility-request.json`, `visibility.json`, `person-profile.json`, `gift-notes-request.json`, `profile-picture.json` and `invitation-accept-request.json`. They are copied into `rybn-mobile/Packages/RybnKit/Tests/RybnKitTests/Fixtures/`, so change both together.

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
