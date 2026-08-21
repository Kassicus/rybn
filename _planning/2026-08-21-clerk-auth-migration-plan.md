# Clerk Auth Migration & Capacitor Removal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase Auth with Clerk as the identity provider while keeping Supabase RLS enforcement, and remove the Capacitor iOS wrapper.

**Architecture:** Clerk issues the session token; Supabase accepts it via its native third-party auth integration and enforces RLS against `auth.jwt()->>'sub'` instead of `auth.uid()`. Supabase clients take an `accessToken` callback rather than managing cookies, which lets the `@supabase/ssr` dependency go away entirely. The schema is rebuilt as a single Clerk-native baseline with `text` identity columns.

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript 5.3+, `@clerk/nextjs`, `@supabase/supabase-js` v2.76.1, PostgreSQL 17 (Supabase), Tailwind 3.4

**Spec:** `_planning/2026-08-21-clerk-auth-migration-design.md`

## Global Constraints

- Node `>=20.9.0` (from `package.json` engines).
- Identity columns are `text`, never `uuid`. Clerk IDs look like `user_2abc123…`.
- RLS policies read `(select auth.jwt()->>'sub')`. The `select` wrapper is
  required — it makes Postgres evaluate the claim once per query instead of
  once per row.
- `auth.uid()` must not appear anywhere. It expects a `uuid` and always
  returns null for Clerk tokens.
- Clerk session tokens must carry the claim `role: "authenticated"`.
  Supabase rejects tokens without it.
- `auth.users` must not be referenced by any table, policy, or function.
- `@supabase/ssr` must be absent from `package.json` when done.
- No `@capacitor/*` package, `ios/` directory, or Capacitor reference may
  remain.
- The linked Supabase project is `xomvbdvvrlbxoyqdsstt`. The Vercel project
  is `rybn` (`prj_rhYQjvhPlaCm3nEWdcHy3kVj4zxy`).
- Production deploys happen by pushing to `main`; Vercel's git integration
  builds it. Do not use `vercel --prod`.

## Environment Notes (verified, non-obvious)

These were checked on this machine. They change what is and isn't possible:

- **Docker is not installed.** `supabase start` and `supabase db reset --local`
  are unavailable. All database work targets the linked remote project.
- **`supabase db reset --linked` does work** against the remote project. This
  is what makes the squash-to-baseline possible.
- **`supabase db query "<sql>" --linked`** executes arbitrary SQL remotely and
  is the basis of the RLS test harness.
- **`psql` is available** at `/opt/homebrew/bin/psql` if needed.
- **The Supabase CLI is not installed globally.** Invoke it as
  `npx --yes supabase@latest`.
- **The Vercel CLI is 54.0.0 and has a bug**: `vercel env add <name> preview
  --yes` re-prompts forever instead of applying. Use the REST API for preview
  env vars, or upgrade the CLI first.

## Testing Strategy (read before Task 1)

This repository has **no test infrastructure** — no framework, no test files,
no test script. Two deliberate decisions follow:

1. **RLS gets real, automated tests.** The spec requires proving user
   isolation, which no type-checker can do. Task 2 builds a SQL-level harness
   using `SET LOCAL request.jwt.claims` to impersonate Clerk users. It needs
   no Docker, no Clerk, and no npm test framework, and it runs in a
   transaction that rolls back, so it never pollutes data. This is where TDD
   genuinely applies and Task 3 follows a strict red-green cycle.

2. **The application layer is verified by `type-check`, `build`, and scripted
   manual flows — not unit tests.** Introducing Vitest and React Testing
   Library to a zero-test codebase is scope the user did not ask for, and it
   would not meaningfully de-risk what is largely a mechanical call-site
   substitution. TypeScript catches the substitution errors; the auth flows
   are inherently integration-level. If you disagree, raise it before Task 5
   rather than silently adding a framework.

**A verified fact that makes the cutover safe:** when a Supabase client is
constructed with the `accessToken` option, `supabase.auth` becomes a Proxy
that throws on *any* property access
(`node_modules/@supabase/supabase-js/dist/module/SupabaseClient.js:55-60`).
A missed `supabase.auth.getUser()` therefore fails loudly and immediately
rather than silently returning null. `npm run build` exercises server
components and will surface most of them at build time.

## Expected Broken Window

Tasks 3 through 6 leave the running app non-functional: after Task 3 the
schema expects Clerk claims that the app does not yet send. This is inherent
to a cutover, not a mistake. The database remains independently verifiable
throughout via `npm run test:rls`. The app is expected to work again at the
end of Task 6, and is fully verified in Task 10. Do not try to "fix" the app
mid-window.

## File Structure

**Created:**
- `scripts/test-rls.sh` — runner that executes each SQL test file remotely
- `supabase/tests/rls/00_harness_smoke.sql` — proves the harness itself works
- `supabase/tests/rls/01_wishlist_isolation.sql` — wishlist privacy assertions
- `supabase/tests/rls/02_profile_isolation.sql` — profile field privacy
- `supabase/tests/rls/03_group_membership.sql` — group scoping, recursion check
- `supabase/tests/rls/04_privacy_overrides.sql` — per-group privacy overrides
- `supabase/tests/rls/05_profile_provisioning.sql` — text id upsert idempotency
- `supabase/migrations/20260821000000_clerk_native_baseline.sql` — whole schema
- `supabase/config.toml` — local config incl. third-party auth block
- `lib/auth/require-auth.ts` — the single server-side identity choke point
- `lib/supabase/use-supabase.ts` — browser client hook (needs `useSession`)

**Modified:**
- `lib/supabase/server.ts`, `lib/supabase/client.ts`, `lib/supabase/admin.ts`
- `proxy.ts`, `app/layout.tsx`, `next.config.ts`, `package.json`
- 44 files containing `auth.getUser()` call sites
- `components/ui/image-input.tsx`, `components/gifts/ChatWindow.tsx`,
  `components/layout/TopBar.tsx`, `components/layout/MobileDrawer.tsx`,
  `components/vibe/DashboardNav.tsx`

**Deleted:**
- `ios/`, `lib/capacitor/`, `capacitor.config.ts`
- `lib/supabase/middleware.ts`, `app/auth/callback/route.ts`
- `app/(auth)/set-username/`, `app/(auth)/verify-email/`
- `components/auth/OAuthButton.tsx`, `lib/actions/auth.ts`
- `supabase/migrations/*` (51 files, archived to `supabase/migrations_archive/`)

---

### Task 1: Remove Capacitor

Fully independent of the auth work. Do it first to shrink the surface area
everything else has to touch.

**Files:**
- Delete: `ios/`, `lib/capacitor/bridge.ts`, `lib/capacitor/camera.ts`, `lib/capacitor/deeplinks.ts`, `capacitor.config.ts`
- Modify: `package.json`, `components/ui/image-input.tsx`, `next.config.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. `components/ui/image-input.tsx` keeps its existing exported props; only its internals change.

- [ ] **Step 1: Confirm the only two app-level consumers**

```bash
grep -rn "@capacitor/\|lib/capacitor\|isNativeApp\|Capacitor\." app components lib hooks --include="*.ts" --include="*.tsx" | grep -v "^lib/capacitor/"
```

Expected: exactly two files — `components/ui/image-input.tsx` and
`components/auth/OAuthButton.tsx`. If more appear, stop and report; the plan
assumed two.

- [ ] **Step 2: Read how image-input uses the native camera**

```bash
grep -n "isNativeApp\|takePicture\|capacitor" components/ui/image-input.tsx
```

Note the branch. You are removing the native branch and keeping the web
`<input type="file">` path that already exists alongside it.

- [ ] **Step 3: Strip the native branch from BOTH consumers**

Both files must be de-Capacitored in this step. `lib/capacitor/` is deleted
in Step 4, and `OAuthButton.tsx` is not deleted until Task 8 — if its imports
are left dangling, the build in Step 8 fails on unresolved modules.

In `components/ui/image-input.tsx`: remove the
`import { isNativeApp } from "@/lib/capacitor/bridge"` and the camera import,
then delete the `if (isNativeApp()) { … }` branch so only the file-input path
remains. Do not change the component's props or exported name.

In `components/auth/OAuthButton.tsx`: remove both imports (lines 6-7,
`@/lib/capacitor/bridge` and `@/lib/capacitor/deeplinks`), then delete the
`if (isNativeApp()) { … }` branch at line 23 along with its
`openInAppBrowser` call, keeping only the `else` branch that calls
`signInWithOAuth` with `redirectTo: ${window.location.origin}/auth/callback`.
The component keeps working on web until Task 8 removes it.

- [ ] **Step 4: Delete the Capacitor files**

```bash
git rm -r ios lib/capacitor capacitor.config.ts
```

`components/auth/OAuthButton.tsx` is left alone here; Task 8 deletes it.
Removing it now would break `login` and `register`, which still import it.

- [ ] **Step 5: Remove the six packages**

```bash
npm uninstall @capacitor/app @capacitor/browser @capacitor/camera @capacitor/core @capacitor/ios @capacitor/cli
```

- [ ] **Step 6: Drop the Capacitor CSP directives**

In `next.config.ts`, change the `frame-ancestors` line from
`"frame-ancestors 'self' capacitor: ionic:"` to `"frame-ancestors 'none'"`,
and change the `X-Frame-Options` header value from `'SAMEORIGIN'` to
`'DENY'`. Leave `connect-src` alone — it was fixed in commit `2db8396` and
is correct.

- [ ] **Step 7: Verify nothing references Capacitor**

```bash
grep -rn "capacitor\|Capacitor" --include="*.ts" --include="*.tsx" --include="*.json" . | grep -v node_modules | grep -v package-lock.json
```

Expected: no output. If `OAuthButton.tsx` still appears, Step 3 was only
half-applied — go back and finish it before continuing.

- [ ] **Step 8: Verify the build**

```bash
npm run type-check && npm run build
```

Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: remove Capacitor iOS wrapper

The iOS app was a remote-URL wrapper pointing at rybn.app rather than a
bundled static export, so removing it has no effect on the web build.
Drops six packages, the ios/ project, lib/capacitor/, and the CSP
directives that existed only for the native WebView."
```

---

### Task 2: RLS test harness

Builds the mechanism that makes Task 3 verifiable. Ends with a passing smoke
test against the *current* schema, proving the harness works before it is
relied upon.

**Files:**
- Create: `scripts/test-rls.sh`, `supabase/tests/rls/00_harness_smoke.sql`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run test:rls` — runs every `supabase/tests/rls/*.sql` file
  in sorted order against the linked project; exits non-zero if any file
  raises. Later tasks add files to that directory and rely on this contract.
- Produces: the SQL convention `perform set_config('request.jwt.claims', …, true)`
  documented in Step 1, which Task 3's tests reuse verbatim.

- [ ] **Step 1: Write the smoke test first**

Create `supabase/tests/rls/00_harness_smoke.sql`. This asserts the
impersonation mechanism itself works — that claims set via `set_config` are
visible to `auth.jwt()`. It deliberately does not depend on any table, so it
survives the Task 3 schema rewrite unchanged.

```sql
-- Proves the RLS harness can impersonate a Clerk user.
-- Depends on no application table, so it is valid before and after the
-- schema baseline.
do $$
declare
  v_sub text;
  v_role text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"user_harness_smoke","role":"authenticated"}', true);

  select auth.jwt()->>'sub' into v_sub;
  if v_sub is distinct from 'user_harness_smoke' then
    raise exception 'HARNESS FAIL: expected sub=user_harness_smoke, got %', v_sub;
  end if;

  select auth.jwt()->>'role' into v_role;
  if v_role is distinct from 'authenticated' then
    raise exception 'HARNESS FAIL: expected role=authenticated, got %', v_role;
  end if;

  raise notice 'HARNESS OK';
end $$;
```

- [ ] **Step 2: Write the runner**

Create `scripts/test-rls.sh`. Each file runs inside `begin … rollback` so
tests can insert fixture rows without persisting them.

```bash
#!/usr/bin/env bash
# Runs every RLS test file against the linked Supabase project.
# Each file is wrapped in a transaction that is always rolled back, so
# fixture data never persists. A file signals failure by RAISE EXCEPTION.
set -uo pipefail

SUPABASE="npx --yes supabase@latest"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failed=0
ran=0

for f in "$DIR"/supabase/tests/rls/*.sql; do
  [ -e "$f" ] || { echo "no test files found"; exit 1; }
  name="$(basename "$f")"
  sql="begin; $(cat "$f") ; rollback;"

  if out=$($SUPABASE db query "$sql" --linked 2>&1); then
    if echo "$out" | grep -qiE '"?(error|ERROR)"?[": ]'; then
      echo "FAIL  $name"
      echo "$out" | sed 's/^/      /' | head -20
      failed=1
    else
      echo "PASS  $name"
    fi
  else
    echo "FAIL  $name"
    echo "$out" | sed 's/^/      /' | head -20
    failed=1
  fi
  ran=$((ran+1))
done

echo "---"
if [ "$failed" -eq 0 ]; then
  echo "$ran RLS test file(s) passed"
else
  echo "RLS tests FAILED"
fi
exit "$failed"
```

- [ ] **Step 3: Make it executable and add the npm script**

```bash
chmod +x scripts/test-rls.sh
```

Add to the `scripts` block in `package.json`:

```json
"test:rls": "./scripts/test-rls.sh"
```

- [ ] **Step 4: Run it and verify it passes**

```bash
npm run test:rls
```

Expected: `PASS  00_harness_smoke.sql` and `1 RLS test file(s) passed`.

- [ ] **Step 5: Verify the harness actually detects failure**

A test harness that cannot fail is worthless. Temporarily change
`'user_harness_smoke'` in the `raise exception` comparison on line 12 of the
smoke test to `'wrong_value'`, then re-run.

```bash
npm run test:rls
```

Expected: `FAIL  00_harness_smoke.sql` and exit code 1. **Revert the change**
and confirm it passes again before continuing.

- [ ] **Step 6: Commit**

```bash
git add scripts/test-rls.sh supabase/tests/rls/00_harness_smoke.sql package.json
git commit -m "test: add SQL-level RLS test harness

Impersonates users by setting request.jwt.claims, so policies can be
tested without Clerk, Docker, or an npm test framework. Each file runs in
a transaction that is rolled back, so fixtures never persist.

Verified the harness reports failure, not just success."
```

---

### Task 3: Clerk-native baseline schema

The heart of the migration, and the only task with a genuine red-green cycle.
Write the isolation tests first, watch them fail against the current
`auth.uid()` schema, then make them pass with the new baseline.

**Files:**
- Create: `supabase/tests/rls/01_wishlist_isolation.sql`, `supabase/tests/rls/02_profile_isolation.sql`, `supabase/tests/rls/03_group_membership.sql`
- Create: `supabase/migrations/20260821000000_clerk_native_baseline.sql`
- Create: `supabase/config.toml`
- Delete: all 51 files in `supabase/migrations/` (archive first)

**Interfaces:**
- Consumes: `npm run test:rls` from Task 2.
- Produces: a schema where every identity column is `text` holding a Clerk
  user ID, `user_profiles.id text primary key` is the referent for all
  identity FKs, and the SQL function `requesting_user_id() returns text`
  exists. Task 7 relies on `user_profiles` accepting a `text` id on upsert.

- [ ] **Step 1: Capture the current schema as a reference**

You are rewriting, not editing, but you need the current shape to work from.

```bash
npx --yes supabase@latest db dump --linked -f /tmp/rybn-current-schema.sql
wc -l /tmp/rybn-current-schema.sql
```

Keep this file open while writing the baseline. It is the source of truth for
table and column names, which the plan does not restate in full.

- [ ] **Step 2: Write the wishlist isolation test**

Create `supabase/tests/rls/01_wishlist_isolation.sql`. This is the spec's
headline guarantee: one user must not read another's private wishlist items.

```sql
-- A user must never read another user's private wishlist items.
do $$
declare
  v_visible int;
begin
  -- Seed two users and one private item owned by user_b.
  -- set_config(..., true) is transaction-local; the runner rolls back.
  insert into user_profiles (id, username, display_name)
    values ('user_test_a', 'testuser_a', 'Test A'),
           ('user_test_b', 'testuser_b', 'Test B');

  insert into wishlist_items (user_id, title, privacy_settings)
    values ('user_test_b', 'Secret Item', '{"default":"private","overrides":{}}');

  -- Impersonate user A.
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_a","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from wishlist_items where user_id = 'user_test_b';

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: user_test_a sees % private wishlist item(s) of user_test_b',
      v_visible;
  end if;

  -- And the owner must still see their own.
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_b","role":"authenticated"}', true);

  select count(*) into v_visible
    from wishlist_items where user_id = 'user_test_b';

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: owner user_test_b sees % of their own items, expected 1',
      v_visible;
  end if;

  raise notice 'wishlist isolation OK';
end $$;
```

- [ ] **Step 3: Write the profile field privacy test**

Create `supabase/tests/rls/02_profile_isolation.sql`.

```sql
-- profile_info rows default to private and must not leak to strangers.
do $$
declare
  v_visible int;
begin
  insert into user_profiles (id, username, display_name)
    values ('user_test_c', 'testuser_c', 'Test C'),
           ('user_test_d', 'testuser_d', 'Test D');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values ('user_test_d', 'sizes', 'shirt', 'L',
            '{"default":"private","overrides":{}}');

  perform set_config('request.jwt.claims',
    '{"sub":"user_test_c","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from profile_info where user_id = 'user_test_d';

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: user_test_c sees % private profile field(s) of user_test_d',
      v_visible;
  end if;

  raise notice 'profile isolation OK';
end $$;
```

- [ ] **Step 4: Write the group membership / recursion test**

Create `supabase/tests/rls/03_group_membership.sql`. This also guards the
recursion fix — if the membership policies recurse, this raises
`stack depth limit exceeded` rather than returning a wrong count.

```sql
-- Group rows are visible only to members, and the membership policies
-- must not recurse (recursion surfaces as stack depth exceeded).
do $$
declare
  v_visible int;
  v_group_id uuid;
begin
  insert into user_profiles (id, username, display_name)
    values ('user_test_e', 'testuser_e', 'Test E'),
           ('user_test_f', 'testuser_f', 'Test F');

  insert into groups (name, type, invite_code, created_by)
    values ('Test Group', 'family', 'TESTCODE1', 'user_test_e')
    returning id into v_group_id;

  insert into group_members (group_id, user_id, role)
    values (v_group_id, 'user_test_e', 'owner')
    on conflict do nothing;

  -- Non-member must not see the group.
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_f","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from groups where id = v_group_id;
  if v_visible <> 0 then
    raise exception 'RLS FAIL: non-member sees group (count=%)', v_visible;
  end if;

  -- Member must see it.
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_e","role":"authenticated"}', true);

  select count(*) into v_visible from groups where id = v_group_id;
  if v_visible <> 1 then
    raise exception 'RLS FAIL: member sees % of their group, expected 1', v_visible;
  end if;

  raise notice 'group membership OK';
end $$;
```

- [ ] **Step 5: Write the group privacy override test**

Create `supabase/tests/rls/04_privacy_overrides.sql`. This covers the spec's
"group-scoped privacy overrides behave as they did before" criterion.
`can_view_field` is the most intricate logic in the schema and its user
parameters change from `uuid` to `text`, so it is the likeliest place for a
silent regression.

```sql
-- can_view_field must honour per-group overrides after the uuid->text change.
do $$
declare
  v_group_id uuid;
  v_can boolean;
begin
  insert into user_profiles (id, username, display_name)
    values ('user_ov_owner', 'ovowner', 'Owner'),
           ('user_ov_peer',  'ovpeer',  'Peer'),
           ('user_ov_stranger', 'ovstranger', 'Stranger');

  insert into groups (name, type, invite_code, created_by)
    values ('Override Group', 'family', 'OVCODE01', 'user_ov_owner')
    returning id into v_group_id;

  insert into group_members (group_id, user_id, role)
    values (v_group_id, 'user_ov_owner', 'owner'),
           (v_group_id, 'user_ov_peer',  'member')
    on conflict do nothing;

  -- Private by default, but shared with this one group.
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values ('user_ov_owner', 'sizes', 'shoe', '10',
            jsonb_build_object(
              'default', 'private',
              'overrides', jsonb_build_object(v_group_id::text, 'group')));

  -- A shared-group member may see it.
  select can_view_field('user_ov_owner', 'user_ov_peer',
    (select privacy_settings from profile_info
      where user_id = 'user_ov_owner' and field_name = 'shoe'))
  into v_can;

  if v_can is not true then
    raise exception 'OVERRIDE FAIL: group member cannot see overridden field';
  end if;

  -- A stranger may not.
  select can_view_field('user_ov_owner', 'user_ov_stranger',
    (select privacy_settings from profile_info
      where user_id = 'user_ov_owner' and field_name = 'shoe'))
  into v_can;

  if v_can is not false then
    raise exception 'OVERRIDE FAIL: stranger can see overridden field';
  end if;

  -- The owner always sees their own.
  select can_view_field('user_ov_owner', 'user_ov_owner',
    (select privacy_settings from profile_info
      where user_id = 'user_ov_owner' and field_name = 'shoe'))
  into v_can;

  if v_can is not true then
    raise exception 'OVERRIDE FAIL: owner cannot see their own field';
  end if;

  raise notice 'privacy overrides OK';
end $$;
```

- [ ] **Step 6: Run the tests and watch them fail (RED)**

```bash
npm run test:rls
```

Expected: `00_harness_smoke.sql` passes; the four new files (`01`-`04`)
**FAIL**. The
current schema has `uuid` identity columns, so inserting `'user_test_a'` is
an invalid uuid. That specific error is the correct failure — it proves the
tests exercise the columns the baseline is about to change.

- [ ] **Step 7: Archive the existing migrations**

```bash
mkdir -p supabase/migrations_archive
git mv supabase/migrations/*.sql supabase/migrations_archive/
ls supabase/migrations_archive/*.sql | wc -l
```

Expected: 56 files (51 timestamped + 5 non-timestamped debug scripts). The
archive is kept for reference; the CLI ignores it because it is outside
`supabase/migrations/`.

- [ ] **Step 8: Write the baseline migration**

Create `supabase/migrations/20260821000000_clerk_native_baseline.sql` using
`/tmp/rybn-current-schema.sql` as the reference for table and column names.
Apply these transformations exactly:

1. **Helper function first**, before any policy:

```sql
create or replace function public.requesting_user_id()
returns text
language sql
stable
as $$
  select auth.jwt()->>'sub'
$$;
```

2. **`user_profiles` becomes the identity root**, with a `text` primary key
   and no reference to `auth.users`:

```sql
create table public.user_profiles (
  id text primary key,
  username text unique,
  display_name text,
  email text,
  avatar_url text,
  bio text,
  email_preferences jsonb default '{
    "email_group_invites": true,
    "email_date_reminders": true,
    "email_gift_updates": true,
    "email_exchange_notifications": true,
    "email_marketing": false
  }'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint username_length check (
    username is null or (char_length(username) between 3 and 30)),
  constraint username_format check (
    username is null or username ~ '^[a-zA-Z0-9_-]+$'),
  constraint bio_length check (bio is null or char_length(bio) <= 500)
);
```

   Note `username` is nullable — Clerk may create the profile before a
   username exists, and Task 7 upserts on first request.

3. **Every identity column becomes `text` referencing `user_profiles(id)`.**
   Apply to all of: `user_id`, `created_by`, `invited_by`, `target_user_id`,
   `assigned_to`, `claimed_by`, `celebrant_id`, `notified_user_id`.

```sql
-- Before (from the archive):
--   user_id uuid references auth.users(id) on delete cascade not null
-- After:
     user_id text references public.user_profiles(id) on delete cascade not null
```

   Non-identity `id` columns stay `uuid primary key default gen_random_uuid()`.

4. **Every policy uses the helper**, wrapped in `select`:

```sql
-- Before:
--   using (auth.uid() = user_id)
-- After:
     using ((select public.requesting_user_id()) = user_id)
```

5. **Break the group_members recursion** with `SECURITY DEFINER` helpers
   rather than querying the table from inside its own policy:

```sql
create or replace function public.is_group_member(p_group_id uuid, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id and user_id = p_user_id
  )
$$;

create or replace function public.is_group_admin(p_group_id uuid, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_members
    where group_id = p_group_id
      and user_id = p_user_id
      and role in ('owner', 'admin')
  )
$$;
```

   `security definer` runs the body as the function owner with RLS
   suspended, so the policy on `group_members` never re-enters itself.
   Policies then read:

```sql
create policy "members read their groups" on public.groups for select
  using (public.is_group_member(id, (select public.requesting_user_id())));
```

6. **Widen the domain functions.** `can_view_field` and `get_shared_groups`
   carry over from the archive with their `uuid` user parameters changed to
   `text`. Their bodies are otherwise unchanged.

7. **Do not recreate** `create_user_profile_on_signup()`, the
   `on_auth_user_created` trigger, or anything referencing `auth.users`.
   Task 7 replaces that path.

8. **Recreate the storage buckets** `wishlist-images` and `gift-photos` as
   public, per `supabase/migrations_archive/20251203000000_create_image_storage_buckets.sql`.

- [ ] **Step 9: Add supabase/config.toml**

Create `supabase/config.toml`. Get the Clerk domain in Task 4; use a
placeholder now only if Task 4 has not run, and return to fill it.

```toml
project_id = "xomvbdvvrlbxoyqdsstt"

[auth.third_party.clerk]
enabled = true
domain = "REPLACE_WITH_CLERK_DOMAIN"
```

- [ ] **Step 10: Reset the remote database to the baseline**

This drops everything and replays only the baseline. It is safe because all
14 tables are empty — confirm that first:

```bash
npx --yes supabase@latest db query "select sum(n_live_tup) as rows from pg_stat_user_tables where schemaname='public'" --linked
```

Expected: `0`. **If this is not 0, stop and report** — someone has signed up
and the plan's central assumption no longer holds.

```bash
npx --yes supabase@latest db reset --linked
```

- [ ] **Step 11: Run the tests and watch them pass (GREEN)**

```bash
npm run test:rls
```

Expected: all five files (`00`-`04`) PASS. If `03_group_membership.sql` fails with
`stack depth limit exceeded`, the recursion fix in Step 8.5 is wrong — the
policy is still querying `group_members` directly instead of going through
`is_group_member`.

- [ ] **Step 12: Verify no auth.uid or auth.users survives**

```bash
grep -rn "auth\.uid()\|auth\.users" supabase/migrations/
```

Expected: no output.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat(db): Clerk-native baseline schema

Replaces 51 migrations with a single baseline written for Clerk from the
start: text identity columns holding Clerk user IDs, user_profiles as the
identity root instead of auth.users, and policies reading
(select requesting_user_id()) rather than auth.uid().

Breaks the group_members RLS recursion with SECURITY DEFINER membership
helpers, which is what forced the admin-client bypasses.

Old migrations archived under supabase/migrations_archive/."
```

---

### Task 4: Clerk provisioning, provider, and middleware

Gets Clerk mounted and `auth()` working. Must land before Task 5, because
`auth()` throws outside `clerkMiddleware`.

**Files:**
- Modify: `app/layout.tsx`, `proxy.ts`, `package.json`, `.env.local`, `supabase/config.toml`
- Delete: `lib/supabase/middleware.ts`

**Interfaces:**
- Produces: `auth()` from `@clerk/nextjs/server` usable in any server
  component, server action, or route handler. Task 5 depends on this.
- Produces: `CLERK_*` env vars present locally and on all three Vercel
  environments.

- [ ] **Step 1: Provision Clerk via the Vercel Marketplace**

```bash
npx vercel@latest integration add clerk
```

Follow the prompts. This creates the Clerk application and syncs
`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` into Development,
Preview, and Production automatically — which is why this path is preferred
over creating the app manually in Clerk's dashboard.

- [ ] **Step 2: Pull the new env vars locally**

```bash
npx vercel@latest env pull .env.local --environment=development --yes
grep -c "CLERK" .env.local
```

Expected: at least 2. Confirm `NEXT_PUBLIC_SUPABASE_URL` and the other
existing vars survived the pull.

- [ ] **Step 3: Configure the required role claim in Clerk**

In the Clerk Dashboard → **Sessions** → **Customize session token**, add:

```json
{ "role": "authenticated" }
```

This is mandatory. Supabase rejects a Clerk token without it, and the
failure mode is every query returning empty rather than an explicit error.

- [ ] **Step 4: Register Clerk as a Supabase third-party auth provider**

In the Supabase Dashboard for project `xomvbdvvrlbxoyqdsstt` →
**Authentication** → **Sign In / Providers** → **Third Party Auth** → add
Clerk, pasting the Clerk domain (visible in the Clerk dashboard, of the form
`your-app.clerk.accounts.dev`).

Then put the same domain into `supabase/config.toml`, replacing
`REPLACE_WITH_CLERK_DOMAIN` from Task 3 Step 9.

- [ ] **Step 5: Enable Google as a Clerk social connection**

Clerk Dashboard → **User & Authentication** → **Social Connections** →
enable **Google**. This replaces the Supabase Google provider; method parity
with the old system is email/password plus Google.

- [ ] **Step 6: Install the SDK**

```bash
npm install @clerk/nextjs
```

- [ ] **Step 7: Replace the proxy with clerkMiddleware**

Overwrite `proxy.ts` entirely. Route protection moves from the hand-kept
`protectedRoutes` array to `createRouteMatcher`; the list below is copied
from the old `lib/supabase/middleware.ts`.

```ts
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

const isProtectedRoute = createRouteMatcher([
  "/dashboard(.*)",
  "/groups(.*)",
  "/profile(.*)",
  "/wishlist(.*)",
  "/gifts(.*)",
  "/gift-tracker(.*)",
  "/gift-exchange(.*)",
  "/secret-santa(.*)",
  "/settings(.*)",
]);

export const proxy = clerkMiddleware(async (auth, request) => {
  if (isProtectedRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
```

- [ ] **Step 8: Delete the Supabase middleware**

```bash
git rm lib/supabase/middleware.ts
```

- [ ] **Step 9: Mount ClerkProvider**

In `app/layout.tsx`, import `ClerkProvider` from `@clerk/nextjs` and wrap the
existing tree. It must sit outside `QueryProvider`.

```tsx
import { ClerkProvider } from "@clerk/nextjs";

// …inside RootLayout's return, wrapping <html>:
return (
  <ClerkProvider>
    <html lang="en" className={quicksand.variable}>
      <body className={`${quicksand.className} overflow-x-hidden`}>
        <QueryProvider>
          {children}
          <Analytics />
        </QueryProvider>
      </body>
    </html>
  </ClerkProvider>
);
```

- [ ] **Step 10: Verify Clerk is mounted**

```bash
npm run type-check
npm run dev
```

Then in another shell:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/dashboard
```

Expected: a 307/302 to a Clerk sign-in URL, not to `/login`. This proves
`clerkMiddleware` is active. The page itself will not render correctly yet —
that is the expected broken window.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(auth): mount Clerk provider and middleware

Provisions Clerk through the Vercel Marketplace so CLERK_* vars sync to
all three environments, replaces the Supabase cookie middleware with
clerkMiddleware, and moves route protection to createRouteMatcher.

The role: authenticated session claim is required by Supabase; without it
every query silently returns empty."
```

---

### Task 5: requireAuth choke point and call-site migration

The mechanical bulk of the migration: 104 `auth.getUser()` call sites across
44 files. Must complete before Task 6, or the throwing Proxy breaks the app.

**Files:**
- Create: `lib/auth/require-auth.ts`
- Modify: `lib/utils/authorization.ts` and the 44 files listed in Step 2
- Delete: `lib/hooks/useAuth.ts`

**Interfaces:**
- Consumes: `auth()` from Task 4.
- Produces: `requireAuth(): Promise<string>` — returns the Clerk user ID or
  throws. `getUserId(): Promise<string | null>` — returns the ID or null for
  optional-auth paths. Tasks 7-9 use both.

- [ ] **Step 1: Write the choke point**

Create `lib/auth/require-auth.ts`. Everything server-side gets identity here
rather than from a Supabase client.

```ts
import { auth } from "@clerk/nextjs/server";

/**
 * The Clerk user ID for the current request, or null when signed out.
 * Use in paths where being signed out is a legitimate state.
 */
export async function getUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId ?? null;
}

/**
 * The Clerk user ID for the current request. Throws when signed out.
 * Use in server actions and protected pages, which must not proceed
 * without an identity.
 */
export async function requireAuth(): Promise<string> {
  const userId = await getUserId();
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}
```

- [ ] **Step 2: Enumerate the call sites**

```bash
grep -rln "auth.getUser()" app lib components hooks
```

Expected: 38 files (some contain several calls; 104 total). Work through them
file by file, largest first — `lib/actions/gift-tracking.ts` (17),
`lib/actions/wishlist.ts` (13), `lib/actions/gifts.ts` (10).

- [ ] **Step 3: Apply the substitution**

The old pattern, which appears with minor variations throughout:

```ts
const supabase = await createClient();
const { data: { user }, error } = await supabase.auth.getUser();
if (userError || !user) {
  return { error: "Not authenticated" };
}
// …later: user.id
```

becomes:

```ts
import { requireAuth } from "@/lib/auth/require-auth";

const userId = await requireAuth();
// …later: userId
```

Three things to watch:
- `user.id` becomes `userId` — a plain string, no longer an object.
- `user.email` is **not available** from Clerk's `auth()`. Where email is
  needed, read it from `user_profiles.email`, which Task 7 populates.
- Where the old code returned `{ error: "Not authenticated" }` rather than
  throwing, keep that shape — use `getUserId()` and branch, so calling code
  is unaffected.

- [ ] **Step 4: Update the shared authorization helper**

In `lib/utils/authorization.ts`, delete the local `requireAuth` (which used
`supabase.auth.getUser()`) and re-export the new one so existing importers
keep working:

```ts
export { requireAuth, getUserId } from "@/lib/auth/require-auth";
```

The `verifyGroupMembership`, `verifyGroupGiftMembership`,
`verifyGroupGiftOwnership`, and `verifyGiftExchangeMembership` functions keep
their signatures — their `userId: string` parameter now receives a Clerk ID
instead of a uuid, which needs no code change.

- [ ] **Step 5: Delete the client-side auth hook**

`lib/hooks/useAuth.ts` wraps `supabase.auth.getUser()` and
`onAuthStateChange`, neither of which exists under the accessToken client.
Clerk's own `useUser()` replaces it.

```bash
git rm lib/hooks/useAuth.ts
grep -rn "useAuth" app components lib
```

For each remaining importer, replace `const { user } = useAuth()` with
`const { user } = useUser()` from `@clerk/nextjs`. Note the shape differs:
Clerk's user has `user.id`, `user.username`, and
`user.primaryEmailAddress?.emailAddress`.

- [ ] **Step 6: Verify no server-side supabase.auth calls remain**

```bash
grep -rn "supabase.auth\.\|\.auth\.getUser()" app lib components hooks
```

Expected: no output. This gate matters — Task 6 makes any survivor throw at
runtime.

- [ ] **Step 7: Verify types**

```bash
npm run type-check
```

Expected: passes. TypeScript catches the `user.id` → `userId` substitution
errors, which is the main reason this task is verified by the compiler rather
than unit tests.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(auth): route identity through requireAuth

Replaces 104 supabase.auth.getUser() call sites across 38 files with a
single Clerk-backed choke point. Identity is now a Clerk user ID string
rather than a Supabase user object.

Must precede the accessToken client switch: supabase.auth becomes a
throwing Proxy once accessToken is set."
```

---

### Task 6: Supabase clients take Clerk tokens

Closes the broken window. After this the app should function again.

**Files:**
- Modify: `lib/supabase/server.ts`, `lib/supabase/admin.ts`, `package.json`
- Create: `lib/supabase/use-supabase.ts`
- Rewrite: `lib/supabase/client.ts`

**Interfaces:**
- Consumes: Clerk session from Task 4.
- Produces: `createClient()` from `@/lib/supabase/server` — unchanged name and
  signature, so the 44 call sites from Task 5 need no further edits.
- Produces: `useSupabase()` from `@/lib/supabase/use-supabase` — a hook
  returning a memoised browser client. Client components must switch to it.

- [ ] **Step 1: Rewrite the server client**

Overwrite `lib/supabase/server.ts`. Keep the exported name `createClient` —
44 files import it and renaming would mean touching them all again.

```ts
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import type { Database } from "@/types/database";

/**
 * Server-side Supabase client authenticated as the current Clerk user.
 * RLS applies. The accessToken callback is invoked per request, so a
 * refreshed Clerk token is always used.
 */
export async function createClient() {
  const { getToken } = await auth();

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: () => getToken() }
  );
}
```

- [ ] **Step 2: Add the browser client hook**

Create `lib/supabase/use-supabase.ts`. The browser client needs the Clerk
session, which is only reachable from a hook — hence the shape change.

```ts
"use client";

import { useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSession } from "@clerk/nextjs";
import type { Database } from "@/types/database";

/**
 * Browser Supabase client authenticated as the current Clerk user.
 * Memoised on the session so a stable client instance is reused, which
 * matters for realtime subscriptions.
 *
 * Realtime is covered automatically: supabase-js constructs its realtime
 * client with this same accessToken callback.
 */
export function useSupabase() {
  const { session } = useSession();

  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { accessToken: async () => (await session?.getToken()) ?? null }
      ),
    [session]
  );
}
```

- [ ] **Step 3: Delete the old browser client**

```bash
git rm lib/supabase/client.ts
```

- [ ] **Step 4: Migrate the browser consumers**

```bash
grep -rln "from \"@/lib/supabase/client\"" app components lib
```

For each survivor — `app/(dashboard)/wishlist/[itemId]/page.tsx`,
`components/ui/image-input.tsx`, `components/gifts/ChatWindow.tsx`,
`components/layout/TopBar.tsx`, `components/layout/MobileDrawer.tsx`,
`components/vibe/DashboardNav.tsx` — replace:

```ts
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

with:

```ts
import { useSupabase } from "@/lib/supabase/use-supabase";
const supabase = useSupabase();
```

`useSupabase()` is a hook, so it must be called at component top level, not
inside an event handler or `useEffect`. In `image-input.tsx` the two
`createClient()` calls sit inside handlers — hoist a single `useSupabase()`
to the component body and reference it from both.

In `ChatWindow.tsx` the client is created inside a `useEffect`; hoist it and
add it to the effect's dependency array.

- [ ] **Step 5: Confirm the admin client is untouched**

`lib/supabase/admin.ts` uses the service-role key and deliberately bypasses
RLS. It must **not** get an accessToken callback. Verify it still imports
from `@supabase/supabase-js` and is otherwise unchanged.

- [ ] **Step 6: Drop @supabase/ssr**

Nothing manages Supabase cookies any more.

```bash
npm uninstall @supabase/ssr
grep -rn "@supabase/ssr" app lib components hooks package.json
```

Expected: no output.

- [ ] **Step 7: Verify build and signed-out behaviour**

```bash
npm run type-check && npm run build
```

Expected: both pass. A build failure mentioning
`accessing supabase.auth.* is not possible` means Task 5 missed a call site —
find it and fix it there.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): authenticate Supabase clients with Clerk tokens

Server and browser clients now pass a Clerk-backed accessToken callback
instead of managing Supabase session cookies, which lets @supabase/ssr go
entirely.

Realtime needs no special handling: supabase-js builds its realtime client
with the same accessToken callback (SupabaseClient.js:63), so the socket
authenticates as the Clerk user and picks up refreshed tokens."
```

---

### Task 7: Lazy profile provisioning

The `on_auth_user_created` trigger is gone and nothing else ever inserted a
`user_profiles` row. Without this, a new Clerk user has no profile.

**Files:**
- Create: `lib/auth/ensure-profile.ts`
- Modify: `lib/auth/require-auth.ts`
- Create: `supabase/tests/rls/05_profile_provisioning.sql`

**Interfaces:**
- Consumes: `requireAuth()` from Task 5, admin client from `lib/supabase/admin.ts`.
- Produces: `ensureProfile(): Promise<string | null>` — returns the Clerk
  user ID after guaranteeing a `user_profiles` row exists, or `null` when
  signed out.
- Produces: `requireAuthWithProfile(): Promise<string>` — throws when signed
  out. Task 9 uses this one.

- [ ] **Step 1: Write the provisioning helper**

Create `lib/auth/ensure-profile.ts`. It uses the admin client deliberately:
the insert happens before any profile row exists, so RLS policies keyed on
ownership cannot yet authorise it.

```ts
import { currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Guarantees a user_profiles row exists for the signed-in Clerk user.
 *
 * Replaces the old on_auth_user_created trigger. Runs lazily on first
 * authenticated request rather than via webhook, which avoids the race
 * where a user reaches the app before a webhook fires, and self-heals if
 * a row is ever missing.
 *
 * Uses the admin client because no profile row exists yet, so ownership
 * policies cannot authorise the insert.
 */
export async function ensureProfile(): Promise<string | null> {
  const user = await currentUser();
  if (!user) return null;

  const admin = createAdminClient();

  const { error } = await admin.from("user_profiles").upsert(
    {
      id: user.id,
      username: user.username ?? `user_${user.id.slice(-8)}`,
      display_name:
        [user.firstName, user.lastName].filter(Boolean).join(" ") ||
        user.username ||
        null,
      email: user.primaryEmailAddress?.emailAddress ?? null,
      avatar_url: user.imageUrl ?? null,
    },
    { onConflict: "id", ignoreDuplicates: false }
  );

  if (error) {
    console.error("ensureProfile failed", error);
  }

  return user.id;
}
```

- [ ] **Step 2: Wire it into the choke point**

In `lib/auth/require-auth.ts`, have `requireAuth` guarantee the profile. Add
to the existing file:

```ts
import { ensureProfile } from "./ensure-profile";

/**
 * The Clerk user ID, with a guaranteed user_profiles row.
 * Prefer this in pages and actions that read or write profile-linked data.
 */
export async function requireAuthWithProfile(): Promise<string> {
  const userId = await requireAuth();
  await ensureProfile();
  return userId;
}
```

- [ ] **Step 3: Call it where a profile is first needed**

Use `requireAuthWithProfile()` in `app/(dashboard)/layout.tsx`, which every
authenticated page renders through. That gives one provisioning point
covering the whole authenticated surface, rather than an upsert on every
action.

- [ ] **Step 4: Add the provisioning test**

Create `supabase/tests/rls/05_profile_provisioning.sql`, asserting the
`text` primary key accepts a Clerk-shaped ID and the upsert is idempotent.

```sql
-- user_profiles must accept Clerk-shaped text ids and upsert idempotently.
do $$
declare
  v_count int;
begin
  insert into user_profiles (id, username, display_name)
    values ('user_2abc123XYZ', 'clerkuser', 'Clerk User');

  insert into user_profiles (id, username, display_name)
    values ('user_2abc123XYZ', 'clerkuser', 'Clerk User Updated')
    on conflict (id) do update set display_name = excluded.display_name;

  select count(*) into v_count
    from user_profiles where id = 'user_2abc123XYZ';

  if v_count <> 1 then
    raise exception 'PROVISIONING FAIL: expected 1 row, got %', v_count;
  end if;

  raise notice 'provisioning OK';
end $$;
```

- [ ] **Step 5: Run the tests**

```bash
npm run test:rls
```

Expected: all six files (`00`-`05`) pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): provision user_profiles lazily on first request

Replaces the on_auth_user_created trigger, which died with auth.users.
Upserts on first authenticated request from the dashboard layout, so
there is no webhook race and a missing row self-heals."
```

---

### Task 8: Clerk auth UI

**Files:**
- Rewrite: `app/(auth)/login/page.tsx`, `app/(auth)/register/page.tsx`
- Delete: `app/(auth)/set-username/`, `app/(auth)/verify-email/`, `app/auth/callback/route.ts`, `components/auth/OAuthButton.tsx`
- Modify: `components/layout/TopBar.tsx`, `components/layout/MobileDrawer.tsx`, `components/vibe/DashboardNav.tsx`, `.env.local`

**Interfaces:**
- Consumes: `ClerkProvider` from Task 4.
- Produces: sign-in at `/login`, sign-up at `/register`, both Clerk-rendered.

- [ ] **Step 1: Replace the login page**

Overwrite `app/(auth)/login/page.tsx`. Clerk's component handles password
entry, Google, verification, reset, and rate limiting.

```tsx
import { SignIn } from "@clerk/nextjs";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SignIn
        appearance={{
          variables: {
            colorPrimary: "#009E01",
            fontFamily: "var(--font-quicksand)",
            borderRadius: "0.75rem",
          },
        }}
      />
    </div>
  );
}
```

`#009E01` is the project's primary, from `tailwind.config.ts:14`.

- [ ] **Step 2: Replace the register page**

Overwrite `app/(auth)/register/page.tsx` with the same shape, using `SignUp`.
Use identical `appearance` values so the two pages match.

```tsx
import { SignUp } from "@clerk/nextjs";

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SignUp
        appearance={{
          variables: {
            colorPrimary: "#009E01",
            fontFamily: "var(--font-quicksand)",
            borderRadius: "0.75rem",
          },
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Require a username at sign-up**

Clerk Dashboard → **User & Authentication** → **Email, Phone, Username** →
enable **Username** and mark it required. This is what retires the
`set-username` page: Clerk collects it during sign-up, and Task 7 copies it
into `user_profiles`.

- [ ] **Step 4: Point Clerk at the app's routes**

Add to `.env.local`, and mirror into Vercel for all three environments:

```
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/login
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/register
NEXT_PUBLIC_CLERK_SIGN_IN_FALLBACK_REDIRECT_URL=/dashboard
NEXT_PUBLIC_CLERK_SIGN_UP_FALLBACK_REDIRECT_URL=/dashboard
```

Because of the CLI bug noted in Environment Notes, add the preview values via
the REST API rather than `vercel env add … preview --yes`.

- [ ] **Step 5: Delete the superseded routes and component**

```bash
git rm -r "app/(auth)/set-username" "app/(auth)/verify-email" app/auth/callback components/auth/OAuthButton.tsx
```

Clerk owns the OAuth round trip, email verification, and username capture.

- [ ] **Step 6: Replace sign-out affordances**

`TopBar.tsx`, `MobileDrawer.tsx`, and `DashboardNav.tsx` call
`supabase.auth.signOut()`. Replace each with Clerk's `UserButton`, or where
a plain menu item is wanted:

```tsx
import { useClerk } from "@clerk/nextjs";

const { signOut } = useClerk();
// …
<button onClick={() => signOut({ redirectUrl: "/" })}>Sign out</button>
```

- [ ] **Step 7: Verify no dead references remain**

```bash
npm run type-check
grep -rn "set-username\|verify-email\|auth/callback\|OAuthButton" app components lib
```

Expected: type-check passes and grep returns nothing. The middleware
redirect to `/set-username` was already removed with
`lib/supabase/middleware.ts` in Task 4.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(auth): Clerk-rendered sign-in and sign-up

Replaces the hand-built forms with themed Clerk components, which brings
verification, password reset, OAuth, and rate limiting with them.

Retires set-username, verify-email, the OAuth callback route, and
OAuthButton: Clerk collects the username at sign-up and owns the OAuth
round trip."
```

---

### Task 9: Invitation flow

The one flow that changes shape rather than just changing calls. It currently
creates a pre-confirmed user with `auth.admin.createUser` and immediately
signs them in — neither is possible under Clerk.

**Files:**
- Rewrite: `app/(auth)/accept-invite/page.tsx`
- Delete: `lib/actions/auth.ts`
- Modify: `lib/actions/invitations.ts`

**Interfaces:**
- Consumes: `requireAuthWithProfile()` from Task 7.
- Produces: `acceptInvitation(token: string): Promise<{ error?: string; groupId?: string }>`
  in `lib/actions/invitations.ts`, called after sign-up completes.

- [ ] **Step 1: Read the current flow**

```bash
cat "app/(auth)/accept-invite/page.tsx"
grep -n "invitation\|token\|accepted" lib/actions/invitations.ts
```

Understand how the token is validated and what marks an invitation accepted
before changing anything.

- [ ] **Step 2: Add the server action that consumes a token**

In `lib/actions/invitations.ts`, add an action that runs for an
already-authenticated user. It uses the admin client because the invitee is
by definition not yet a group member, so member-scoped policies would reject
the read.

```ts
"use server";

import { requireAuthWithProfile } from "@/lib/auth/require-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function acceptInvitation(
  token: string
): Promise<{ error?: string; groupId?: string }> {
  const userId = await requireAuthWithProfile();
  const admin = createAdminClient();

  const { data: invitation, error } = await admin
    .from("invitations")
    .select("id, group_id, expires_at, accepted")
    .eq("token", token)
    .maybeSingle();

  if (error || !invitation) return { error: "Invitation not found" };
  if (invitation.accepted) return { error: "Invitation already used" };
  if (new Date(invitation.expires_at) < new Date()) {
    return { error: "Invitation has expired" };
  }

  const { error: memberError } = await admin
    .from("group_members")
    .upsert(
      { group_id: invitation.group_id, user_id: userId, role: "member" },
      { onConflict: "group_id,user_id", ignoreDuplicates: true }
    );

  if (memberError) return { error: "Could not join group" };

  await admin
    .from("invitations")
    .update({ accepted: true, accepted_at: new Date().toISOString() })
    .eq("id", invitation.id);

  return { groupId: invitation.group_id };
}
```

- [ ] **Step 3: Rewrite the accept-invite page**

Overwrite `app/(auth)/accept-invite/page.tsx`. Signed-out visitors sign up
through Clerk with the token preserved in the redirect; signed-in visitors
consume it immediately.

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth, SignUp } from "@clerk/nextjs";
import { acceptInvitation } from "@/lib/actions/invitations";
import { Text } from "@/components/ui/text";

export default function AcceptInvitePage() {
  const { isLoaded, isSignedIn } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !token) return;
    acceptInvitation(token).then((result) => {
      if (result.error) setError(result.error);
      else router.push(`/groups/${result.groupId}`);
    });
  }, [isLoaded, isSignedIn, token, router]);

  if (!token) return <Text>This invitation link is missing its token.</Text>;
  if (!isLoaded) return <Text>Loading…</Text>;

  if (!isSignedIn) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <SignUp
          forceRedirectUrl={`/accept-invite?token=${encodeURIComponent(token)}`}
        />
      </div>
    );
  }

  return <Text>{error ?? "Joining group…"}</Text>;
}
```

- [ ] **Step 4: Delete the obsolete signup action**

```bash
git rm lib/actions/auth.ts
grep -rn "signupFromInvitation" app lib components
```

Expected: no output.

- [ ] **Step 5: Verify types**

```bash
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(auth): rework invitation acceptance for Clerk

Replaces admin.createUser plus immediate sign-in, neither of which Clerk
supports, with a normal Clerk sign-up that preserves the token through
redirect and consumes it once authenticated."
```

---

### Task 10: Verification and deploy

**Files:**
- Modify: `next.config.ts`
- No new source files.

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add Clerk to the CSP**

Clerk loads its own script and calls its API, both of which the current CSP
blocks. In `next.config.ts`, extend the derived values near the top:

```ts
const clerkOrigins = "https://*.clerk.accounts.dev https://clerk.rybn.app";
```

Then add `clerkOrigins` to both `script-src` and `connect-src`, and add
`https://img.clerk.com` to `img-src`. Keep the existing Supabase derivation
from commit `2db8396` intact.

- [ ] **Step 2: Full local verification**

```bash
npm run type-check && npm run build && npm run test:rls
```

Expected: all three pass.

- [ ] **Step 3: Confirm the global constraints hold**

```bash
grep -rn "auth\.uid()\|auth\.users" supabase/migrations/ app lib components
grep -rn "@supabase/ssr\|@capacitor" package.json app lib components
grep -rn "supabase.auth\." app lib components hooks
```

Expected: no output from any of the three.

- [ ] **Step 4: Walk the flows manually**

```bash
npm run dev
```

Confirm each, and do not mark this step complete until every one passes:
- Sign up with email/password; land on `/dashboard`.
- A `user_profiles` row exists with the Clerk ID:
  `npx --yes supabase@latest db query "select id, username, email from user_profiles" --linked`
- Sign out, then sign in again.
- Sign in with Google.
- Create a group; create a wishlist item.
- With a **second** account, confirm the first account's private wishlist
  item is not visible.
- Open a group gift chat in two browsers and confirm realtime delivery.
- Send an invitation, open the link signed out, sign up, land in the group.

- [ ] **Step 5: Deploy**

```bash
git push origin main
```

Watch the build, then verify production:

```bash
curl -sI https://www.rybn.app/login | tr ';' '\n' | grep -iE "connect-src|script-src"
curl -s -o /dev/null -w "%{http_code}\n" https://www.rybn.app/login
```

Expected: CSP lists both the Supabase and Clerk origins; `/login` returns 200.
Then repeat the sign-up and sign-in checks from Step 4 against production.

- [ ] **Step 6: Commit any CSP adjustment**

```bash
git add next.config.ts
git commit -m "chore: allow Clerk origins in CSP"
git push origin main
```

---

## Rollback

Every task is a single commit, so `git revert` handles the application layer.
The database is the exception: Task 3 ran `db reset --linked`, which is
destructive. Recovery means restoring `supabase/migrations_archive/` into
`supabase/migrations/` and resetting again. Because the database is empty
throughout, no user data is at risk — but anyone who signs up between Task 3
and a rollback would be lost, so do not leave the migration half-finished in
production.
