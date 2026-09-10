# Gift-Giving Occasions — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every group a shared, always-correct answer to "what gift-giving event is next," surfaced identically on the dashboard, group pages, and wishlists.

**Architecture:** Birthdays stay in `profile_info` and are *derived* live for display by a `security definer` function that inherits their existing per-viewer privacy. Group dates ("Christmas 2026") are stored rows in a new `occasions` table. Nothing is materialized for birthdays in this phase — materialization only becomes necessary in phase 2, when a tag needs a foreign key.

**Tech Stack:** Next.js 16.3.2 (App Router, server actions), Supabase Postgres with RLS, Clerk auth via `requesting_user_id()`, Vitest, Tailwind.

**Spec:** `_planning/2026-09-10-gift-giving-occasions-design.md`

## Global Constraints

- **Occasion context is symmetric; claim context is not.** Owners see occasions, dates, and their own tags. Owners must never see anything claim-derived. `getMyWishlist` (`lib/actions/wishlist.ts:53`) strips claim fields — nothing added here may reintroduce them.
- **Derived occasions inherit `profile_info` privacy exactly.** Gate on `can_view_field(celebrant, viewer, privacy_settings)`. An occasion must never reveal a date the profile field would hide.
- **No function takes a viewer id parameter.** Pin the viewer to `requesting_user_id()` internally. A `p_viewer_id` argument on a `security definer` function granted to `authenticated` is a dump of the user table — which is why `get_upcoming_dates_for_notifications` is granted to `service_role` only.
- **Birthday occasions key on `(kind, celebrant_id, occasion_year)` — never on group.** Group membership is a visibility dimension. Group dates are the opposite and do carry `group_id`.
- **Untagged items are never hidden.** Every item in the database today is untagged.
- **New RLS test files must be added to `supabase/tests/rls/MANIFEST`.** The runner fails on undeclared files *and* on declared-but-missing ones, and every file must use the counter-gated `_harness_result` pattern.
- **Every `create policy` needs an explicit `to authenticated`.** A policy with no `TO` clause applies to `PUBLIC`, which includes `anon` — and the anon key ships to every browser. `supabase/tests/rls/06_anon_has_no_reach.sql` is a standing invariant that fails the whole suite if any `public` policy lacks a named role. Task 1 hit this: the original plan text omitted it on all five policies.
- **An RLS test's success token is `OK_<filename minus .sql>`, including the numeric prefix.** `scripts/test-rls.sh` derives the expected token from the filename, so `11_occasion_visibility.sql` must emit `OK_11_occasion_visibility`. A mismatched token reports as "did not emit its success token" even when every assertion passed.
- **An RLS test must reset `role` to the connecting role before its token insert.** `_harness_result` is a superuser-owned temp table; inserting as `authenticated` fails with `42501: permission denied`. Capture `current_user` at the top and restore it after the last assertion, as `01_wishlist_isolation.sql` does.
- **`types/database.ts` is generated but hand-annotated.** If regenerating, re-apply the four `StoredImageValue` annotations or `lib/storage/image-value.ts` fails to compile. Hand-editing is safer here.
- **Name collision:** `tracked_gifts.occasion` is unrelated free text in the private gift tracker. It is not a foreign key and has nothing to do with this feature.
- **Migrations run against a linked remote project** (`npx supabase db push`). RLS tests run with `npm run test:rls` against that same linked project; each test is wrapped in a rolled-back transaction.

---

### Task 1: `occasions` table, constraints, and RLS

**Files:**
- Create: `supabase/migrations/20260910100000_occasions_schema.sql`
- Create: `supabase/tests/rls/11_occasion_visibility.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.occasions`, enum `public.occasion_kind` with values `'birthday' | 'anniversary' | 'group_date'`, unique index `occasions_celebrant_identity`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260910100000_occasions_schema.sql`:

```sql
-- =============================================================================
-- rybn: gift-giving occasions -- schema
-- =============================================================================
--
-- Two shapes share this table, and the check constraints are what keep them
-- from blurring:
--
--   birthday / anniversary -- celebrant_id set, group_id NULL. Derived from
--     profile_info; one row per celebrant per year, NOT one per group. Mom has
--     one birthday; keying it per group would fragment its tags and claims
--     across audiences. Group membership is a VISIBILITY dimension, which
--     can_view_field() already resolves.
--
--   group_date -- group_id set, celebrant_id NULL, name required. "Christmas
--     2026" in a family group is genuinely a different event from one in a
--     work group, even on the same date.
--
-- Phase 1 stores ONLY group_date rows. Birthdays derive at read time and
-- materialize in phase 2, when tagging first needs a foreign key. There is
-- deliberately NO insert policy for celebrant rows: the only writer will be
-- get_or_create_occasion(), a SECURITY DEFINER function added then. Absent a
-- policy, direct inserts fail closed.
--
-- NAME COLLISION: tracked_gifts.occasion is unrelated free text in the private
-- gift tracker. Not a foreign key, nothing to do with this table.
-- =============================================================================

create type public.occasion_kind as enum ('birthday', 'anniversary', 'group_date');

create table public.occasions (
  id uuid primary key default gen_random_uuid(),
  group_id uuid references public.groups(id) on delete cascade,
  kind public.occasion_kind not null,
  name text,
  occasion_date date not null,
  -- Stored, so occasions_celebrant_identity can key on it. extract(year from
  -- <date>) is immutable, which generated columns require.
  occasion_year integer generated always as
    (extract(year from occasion_date)::integer) stored,
  celebrant_id text references public.user_profiles(id) on delete cascade,
  created_by text references public.user_profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint group_date_shape check (
    kind <> 'group_date'
    or (name is not null and celebrant_id is null and group_id is not null)),
  constraint celebrated_shape check (
    kind = 'group_date'
    or (celebrant_id is not null and group_id is null)),
  constraint occasion_name_length check (
    name is null or char_length(name) between 1 and 200)
);

comment on table public.occasions is
  'Gift-giving events. Birthdays derive from profile_info and materialize only when a tag or claim needs an FK; group dates are always stored.';

-- One row per celebrant per kind per year, deliberately NOT per group. Also
-- makes phase 2 materialization idempotent under concurrency.
create unique index occasions_celebrant_identity
  on public.occasions (kind, celebrant_id, occasion_year)
  where celebrant_id is not null;

create index occasions_group_date_lookup
  on public.occasions (group_id, occasion_date)
  where group_id is not null;

create trigger update_occasions_updated_at
  before update on public.occasions
  for each row execute function public.update_updated_at_column();

alter table public.occasions enable row level security;

-- Group dates: visible to that group's members.
create policy "Members can view their groups' occasions"
  on public.occasions for select to authenticated
  using (
    group_id is not null
    and public.is_group_member(group_id, public.requesting_user_id())
  );

-- Celebrated occasions inherit the underlying profile field's privacy
-- EXACTLY. Without this the table would be a back door around can_view_field:
-- a materialized birthday row would announce a date the profile field hides.
create policy "Celebrated occasions follow the underlying date's privacy"
  on public.occasions for select to authenticated
  using (
    celebrant_id is not null
    and exists (
      select 1 from public.profile_info pi
      where pi.user_id = occasions.celebrant_id
        and pi.category = 'dates'
        and pi.field_name = occasions.kind::text
        and public.can_view_field(
          pi.user_id, public.requesting_user_id(), pi.privacy_settings)
    )
  );

create policy "Group members can create group dates"
  on public.occasions for insert to authenticated
  with check (
    kind = 'group_date'
    and group_id is not null
    and public.is_group_member(group_id, public.requesting_user_id())
    and created_by = public.requesting_user_id()
  );

-- The WITH CHECK is evaluated against the NEW row, so "you did not change
-- group_id" is inexpressible here -- the same limitation the
-- pin_privacy_columns migration documents. It is tolerable in this case: the
-- check re-tests membership against the NEW group_id, so a row can only ever
-- land in a group the actor is already an admin of, and celebrated_shape
-- blocks a kind change.
create policy "Creator or group admin can update group dates"
  on public.occasions for update to authenticated
  using (
    kind = 'group_date'
    and (created_by = public.requesting_user_id()
         or public.is_group_admin(group_id, public.requesting_user_id()))
  )
  with check (
    kind = 'group_date'
    and (created_by = public.requesting_user_id()
         or public.is_group_admin(group_id, public.requesting_user_id()))
  );

create policy "Creator or group admin can delete group dates"
  on public.occasions for delete to authenticated
  using (
    kind = 'group_date'
    and (created_by = public.requesting_user_id()
         or public.is_group_admin(group_id, public.requesting_user_id()))
  );

grant select, insert, update, delete on public.occasions to authenticated;
grant select, insert, update, delete on public.occasions to service_role;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`
Expected: applies cleanly, reports the new migration.

- [ ] **Step 3: Write the failing RLS test**

Create `supabase/tests/rls/11_occasion_visibility.sql`. Follow the counter-gated
pattern in `01_wishlist_isolation.sql` exactly: `_harness_result` temp table, a
`v_checks` counter, one increment per assertion, a floor guard whose N equals
the increment count, and the canonical final select.

```sql
-- A group date must be visible to that group's members and to nobody else.
--
-- Asserted in both directions, as 01_wishlist_isolation.sql explains: a
-- stranger seeing zero is vacuous unless a member is also proven to see one.
--
-- Convention: see 00_harness_smoke.sql. set_config(..., true) is
-- transaction-local and the runner always rolls back, so fixtures never persist.

create temp table _harness_result (token text);

do $$
declare
  v_visible   int;
  v_group     uuid;
  v_orig_role text;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values ('user_occ_a', 'occuser_a', 'Occ A'),
           ('user_occ_b', 'occuser_b', 'Occ B');

  insert into groups (name, type, invite_code, created_by)
    values ('Occ Family', 'family', 'OCCTEST1', 'user_occ_a')
    returning id into v_group;

  -- add_group_creator_as_owner() already added user_occ_a. user_occ_b stays out.

  insert into occasions (group_id, kind, name, occasion_date, created_by)
    values (v_group, 'group_date', 'Christmas 2026', '2026-12-25', 'user_occ_a');

  ---------------------------------------------------------------------------
  -- A non-member must see nothing.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_occ_b","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from occasions where group_id = v_group;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: non-member user_occ_b sees % group occasion(s)', v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The member must see it, or the assertion above passed vacuously.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_occ_a","role":"authenticated"}', true);

  select count(*) into v_visible from occasions where group_id = v_group;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: member user_occ_a sees % group occasion(s), expected 1',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connect role so the token insert below is permitted:
  -- _harness_result is a superuser-owned temp table and `authenticated` has
  -- no privilege on it. Same placement as 01_wishlist_isolation.sql.
  perform set_config('role', v_orig_role, true);

  if v_checks < 2 then
    raise exception 'RLS FAIL: only % checks ran, expected 2', v_checks;
  end if;

  -- Token is OK_<filename minus .sql>, numeric prefix included: the runner
  -- derives what it expects from the filename.
  insert into _harness_result (token) values ('OK_11_occasion_visibility');
end $$;

select token as result from _harness_result;
```

- [ ] **Step 4: Declare the test**

Add `11_occasion_visibility.sql` to `supabase/tests/rls/MANIFEST`, after `10_private_storage.sql`. The runner fails if a `.sql` file is present but undeclared.

- [ ] **Step 5: Run the RLS suite**

Run: `npm run test:rls`
Expected: all files pass, including `11_occasion_visibility.sql` reporting `OK_occasion_visibility`.

- [ ] **Step 6: Prove the test is not vacuous**

Temporarily drop the group-date select policy, re-run, confirm `11_occasion_visibility.sql` FAILS, then recreate the policy and confirm it passes again. Record this in the task report — the harness's static checks cannot tell an assertion from a no-op, so this is the only evidence the test bites.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260910100000_occasions_schema.sql \
        supabase/tests/rls/11_occasion_visibility.sql \
        supabase/tests/rls/MANIFEST
git commit -m "feat(occasions): add occasions table with per-viewer RLS"
```

---

### Task 2: Date helper and the derived-occasions function

**Files:**
- Create: `supabase/migrations/20260910100002_occasions_derivation.sql`
  (renumbered from ...100001: Task 1's review turned up a Critical RLS
  defect in the plan's UPDATE policy, and its fix took ...100001. See the
  ledger's Task 1 rulings.)
- Create: `supabase/tests/rls/12_occasion_derivation.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.occasions` from Task 1.
- Produces:
  - `public.celebration_date_in_year(p_field_value text, p_target_year integer) returns date` — immutable.
  - `public.get_upcoming_occasions(p_days_ahead integer default 30)` returning `(occasion_id uuid, kind public.occasion_kind, name text, occasion_date date, celebrant_id text, celebrant_username text, celebrant_display_name text, group_id uuid, group_name text)`.

- [ ] **Step 1: Confirm the latent Feb-29 crash before fixing it**

Run against the linked project:

```sql
select ('2027-' || substring('2000-02-29' from 6 for 5))::date;
```

Expected: `ERROR: date/time field value out of range: "2027-02-29"`.

This is the exact expression `get_upcoming_dates_for_notifications` evaluates in its WHERE clause across every `profile_info` dates row, so one Feb-29 birthday anywhere takes down the whole reminder run. Record the output in the task report.

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260910100002_occasions_derivation.sql`:

```sql
-- =============================================================================
-- rybn: gift-giving occasions -- derivation
-- =============================================================================

-- The celebration date for a stored 'YYYY-MM-DD' profile date, in a given
-- year. Returns NULL rather than raising on anything malformed.
--
-- This replaces an inline expression that was a latent outage:
-- get_upcoming_dates_for_notifications computed
-- (target_year || '-' || substring(field_value from 6 for 5))::date, which for
-- a 2000-02-29 birthday in a non-leap target year cast '2027-02-29' and raised
-- "date/time field value out of range". Evaluated in a WHERE clause over every
-- dates row, ONE such birthday broke the reminder run for every user.
--
-- Feb 29 clamps to Feb 28 in common years -- the convention most calendars
-- use, and the one that keeps the reminder in the same month.
create or replace function public.celebration_date_in_year(
  p_field_value text,
  p_target_year integer
)
returns date
language plpgsql
immutable
as $$
declare
  v_md text;
begin
  if p_field_value is null or p_field_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  v_md := substring(p_field_value from 6 for 5);

  if v_md = '02-29' and not (
    (p_target_year % 4 = 0 and p_target_year % 100 <> 0)
    or p_target_year % 400 = 0
  ) then
    return (p_target_year || '-02-28')::date;
  end if;

  return (p_target_year || '-' || v_md)::date;
end;
$$;

-- Every occasion the CALLER may see, within p_days_ahead.
--
-- Takes NO viewer parameter, deliberately. A p_viewer_id argument on a
-- SECURITY DEFINER function granted to `authenticated` lets any signed-in
-- caller ask for anyone else's view -- which is exactly why
-- get_upcoming_dates_for_notifications is granted to service_role only. Pinning
-- to requesting_user_id() is the same defence accept_group_invitation() and
-- join_group_with_code() use, and it is what makes an `authenticated` grant
-- safe here.
create or replace function public.get_upcoming_occasions(
  p_days_ahead integer default 30
)
returns table(
  occasion_id uuid,
  kind public.occasion_kind,
  name text,
  occasion_date date,
  celebrant_id text,
  celebrant_username text,
  celebrant_display_name text,
  group_id uuid,
  group_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer text := (select public.requesting_user_id());
  v_year   integer := extract(year from current_date)::integer;
  v_until  date := (current_date + (p_days_ahead || ' days')::interval)::date;
begin
  if v_viewer is null then
    return;
  end if;

  return query
  -- Derived birthdays and anniversaries. One row per celebrant per kind,
  -- never one per shared group: can_view_field() already collapses the group
  -- dimension by returning true if ANY shared group qualifies.
  select
    o.id,
    pi.field_name::public.occasion_kind,
    null::text,
    d.celebration,
    pi.user_id,
    up.username,
    up.display_name,
    null::uuid,
    null::text
  from profile_info pi
  join user_profiles up on up.id = pi.user_id
  cross join lateral (
    select case
      when public.celebration_date_in_year(pi.field_value, v_year) >= current_date
        then public.celebration_date_in_year(pi.field_value, v_year)
      else public.celebration_date_in_year(pi.field_value, v_year + 1)
    end as celebration
  ) d
  -- The materialized twin, when phase 2 has created one. NULL until then, and
  -- the UI must not depend on it being present.
  left join occasions o
    on o.celebrant_id = pi.user_id
   and o.kind = pi.field_name::public.occasion_kind
   and o.occasion_year = extract(year from d.celebration)::integer
  where pi.category = 'dates'
    and pi.field_name in ('birthday', 'anniversary')
    and d.celebration is not null
    and d.celebration between current_date and v_until
    and public.can_view_field(pi.user_id, v_viewer, pi.privacy_settings)

  union all

  -- Stored group dates for the caller's groups.
  select
    o.id,
    o.kind,
    o.name,
    o.occasion_date,
    null::text,
    null::text,
    null::text,
    o.group_id,
    g.name
  from occasions o
  join groups g on g.id = o.group_id
  where o.kind = 'group_date'
    and o.occasion_date between current_date and v_until
    and public.is_group_member(o.group_id, v_viewer)

  order by 4;
end;
$$;

grant execute on function public.celebration_date_in_year(text, integer)
  to authenticated, service_role;
grant execute on function public.get_upcoming_occasions(integer)
  to authenticated, service_role;
```

- [ ] **Step 3: Refactor the existing reminder function to use the helper**

In the same migration file, append a `create or replace` of
`public.get_upcoming_dates_for_notifications` copied verbatim from
`supabase/migrations/20260821000000_clerk_native_baseline.sql:985-1046`, with
**only** these two substitutions, so the Feb-29 fix reaches the reminder path
and the two functions cannot drift:

- in the select list, replace
  `(target_year || '-' || substring(pi.field_value from 6 for 5))::date as celebration_date`
  with `public.celebration_date_in_year(pi.field_value, target_year) as celebration_date`
- in the where clause, replace
  `(target_year || '-' || substring(pi.field_value from 6 for 5))::date between current_date and (current_date + (days_ahead || ' days')::interval)::date`
  with
  `public.celebration_date_in_year(pi.field_value, target_year) between current_date and (current_date + (days_ahead || ' days')::interval)::date`

Change nothing else — not the signature, not the `security definer`, not the
`can_view_field` gate, not the `not exists` dedup against `date_notifications`.
Its `service_role`-only grant is unchanged and must stay that way.

- [ ] **Step 4: Apply the migration**

Run: `npx supabase db push`
Expected: applies cleanly.

- [ ] **Step 5: Verify the Feb-29 fix**

Run against the linked project:

```sql
select public.celebration_date_in_year('2000-02-29', 2027) as common_year,
       public.celebration_date_in_year('2000-02-29', 2028) as leap_year,
       public.celebration_date_in_year('garbage', 2027)    as malformed;
```

Expected: `2027-02-28`, `2028-02-29`, `NULL`. No exception.

- [ ] **Step 6: Write the failing RLS test**

Create `supabase/tests/rls/12_occasion_derivation.sql` using the same
counter-gated pattern, and observe the three conventions in Global Constraints
that Task 1 established by failing on them: the success token must be
`OK_12_occasion_derivation` (derived from the filename, numeric prefix
included); `role` must be reset to the captured `current_user` after the last
assertion and before the token insert; and any policy this test creates as a
fixture needs `to authenticated`. Assert:

1. a birthday with `visibleToGroupTypes: []` (this schema's spelling of
   private — see `valid_wishlist_privacy_settings` in the baseline) does NOT
   appear in `get_upcoming_occasions()` for a co-member;
2. the same birthday DOES appear once it is visible to the shared group type,
   so assertion 1 is not vacuous;
3. it appears exactly **once** for a viewer who shares **two** groups with the
   celebrant — this is the regression guard for the per-celebrant keying, and
   it is the assertion that would have caught the group-scoping flaw.

Follow the fixture and role-switch conventions in `11_occasion_visibility.sql`.
Set `request.jwt.claims` before calling the function; `requesting_user_id()`
reads it.

- [ ] **Step 7: Declare the test**

Add `12_occasion_derivation.sql` to `supabase/tests/rls/MANIFEST`.

- [ ] **Step 8: Run the RLS suite**

Run: `npm run test:rls`
Expected: all pass, including both new files.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260910100002_occasions_derivation.sql \
        supabase/tests/rls/12_occasion_derivation.sql \
        supabase/tests/rls/MANIFEST
git commit -m "feat(occasions): derive upcoming occasions, fix Feb-29 reminder crash"
```

---

### Task 3: Types and occasion display helpers

**Files:**
- Create: `lib/occasions/display.ts`
- Create: `lib/occasions/display.test.ts`
- Modify: `types/database.ts`

**Interfaces:**
- Consumes: the `get_upcoming_occasions` row shape from Task 2.
- Produces:
  - `export type OccasionKind = 'birthday' | 'anniversary' | 'group_date'`
  - `export interface UpcomingOccasion { occasionId: string | null; kind: OccasionKind; name: string | null; occasionDate: string; celebrantId: string | null; celebrantUsername: string | null; celebrantDisplayName: string | null; groupId: string | null; groupName: string | null }`
  - `export function occasionLabel(o: UpcomingOccasion): string`
  - `export function daysUntil(occasionDate: string, today?: Date): number`

- [ ] **Step 1: Write the failing tests**

Create `lib/occasions/display.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { occasionLabel, daysUntil, type UpcomingOccasion } from "./display";

function make(over: Partial<UpcomingOccasion> = {}): UpcomingOccasion {
  return {
    occasionId: null,
    kind: "birthday",
    name: null,
    occasionDate: "2026-10-29",
    celebrantId: "user_1",
    celebrantUsername: "mom",
    celebrantDisplayName: "Mom",
    groupId: null,
    groupName: null,
    ...over,
  };
}

describe("occasionLabel", () => {
  it("uses the celebrant's display name for a birthday", () => {
    expect(occasionLabel(make())).toBe("Mom's Birthday");
  });

  it("falls back to the username when there is no display name", () => {
    expect(occasionLabel(make({ celebrantDisplayName: null })))
      .toBe("mom's Birthday");
  });

  // Possessive of a name already ending in s. Getting this wrong is the kind
  // of detail that makes an app feel unfinished.
  it("does not double the s on a name ending in s", () => {
    expect(occasionLabel(make({ celebrantDisplayName: "Chris" })))
      .toBe("Chris' Birthday");
  });

  it("uses the given name for a group date", () => {
    expect(occasionLabel(make({
      kind: "group_date", name: "Christmas 2026",
      celebrantId: null, celebrantUsername: null, celebrantDisplayName: null,
      groupId: "g1", groupName: "The Suchows",
    }))).toBe("Christmas 2026");
  });
});

describe("daysUntil", () => {
  it("counts whole days ahead", () => {
    expect(daysUntil("2026-10-29", new Date("2026-10-22T12:00:00Z"))).toBe(7);
  });

  it("returns 0 for today", () => {
    expect(daysUntil("2026-10-29", new Date("2026-10-29T23:00:00Z"))).toBe(0);
  });

  // A date string is a calendar day, not an instant. Comparing it against a
  // local-time Date must not slip a day either side of midnight.
  it("is not thrown off by time of day", () => {
    expect(daysUntil("2026-10-29", new Date("2026-10-28T00:30:00Z"))).toBe(1);
    expect(daysUntil("2026-10-29", new Date("2026-10-28T23:30:00Z"))).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/occasions/display.test.ts`
Expected: FAIL — cannot resolve `./display`.

- [ ] **Step 3: Write the implementation**

Create `lib/occasions/display.ts`:

```ts
export type OccasionKind = "birthday" | "anniversary" | "group_date";

export interface UpcomingOccasion {
  /** Null until phase 2 materializes a row for a derived occasion. */
  occasionId: string | null;
  kind: OccasionKind;
  /** Set for group_date only. */
  name: string | null;
  /** Calendar day as 'YYYY-MM-DD'. Not an instant -- see daysUntil. */
  occasionDate: string;
  celebrantId: string | null;
  celebrantUsername: string | null;
  celebrantDisplayName: string | null;
  groupId: string | null;
  groupName: string | null;
}

const KIND_NOUN: Record<Exclude<OccasionKind, "group_date">, string> = {
  birthday: "Birthday",
  anniversary: "Anniversary",
};

/** "Mom's Birthday", "Chris' Birthday", "Christmas 2026". */
export function occasionLabel(o: UpcomingOccasion): string {
  if (o.kind === "group_date") {
    return o.name ?? "Group occasion";
  }

  const who = o.celebrantDisplayName ?? o.celebrantUsername ?? "Someone";
  const possessive = who.endsWith("s") ? `${who}'` : `${who}'s`;
  return `${possessive} ${KIND_NOUN[o.kind]}`;
}

/**
 * Whole days from today to the occasion.
 *
 * occasionDate is a calendar day, so both sides are reduced to UTC midnight
 * before subtracting. Comparing a 'YYYY-MM-DD' against a local-time Date
 * directly slips a day either side of midnight depending on the viewer's
 * offset -- which reads as an off-by-one bug to anyone not in UTC.
 */
export function daysUntil(occasionDate: string, today: Date = new Date()): number {
  const [y, m, d] = occasionDate.split("-").map(Number);
  const target = Date.UTC(y, m - 1, d);
  const from = Date.UTC(
    today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - from) / 86_400_000);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/occasions/display.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Add the database types**

In `types/database.ts`, hand-add an `occasions` entry to `Tables` mirroring the
columns from Task 1, and add `occasion_kind: "birthday" | "anniversary" |
"group_date"` to `Enums`. Hand-edit rather than regenerating — regeneration
drops the four `StoredImageValue` annotations and `lib/storage/image-value.ts`
then fails to compile.

- [ ] **Step 6: Type-check and commit**

Run: `npx tsc --noEmit`
Expected: clean.

```bash
git add lib/occasions/display.ts lib/occasions/display.test.ts types/database.ts
git commit -m "feat(occasions): add occasion display helpers and types"
```

---

### Task 4: `getUpcomingOccasions()` server action

**Files:**
- Create: `lib/actions/occasions.ts`

**Interfaces:**
- Consumes: `get_upcoming_occasions(integer)` from Task 2; `UpcomingOccasion` from Task 3.
- Produces: `export async function getUpcomingOccasions(daysAhead?: number): Promise<{ data: UpcomingOccasion[]; error?: never } | { error: string; data?: never }>`

- [ ] **Step 1: Write the action**

Create `lib/actions/occasions.ts`:

```ts
"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth/require-auth";
import type { UpcomingOccasion } from "@/lib/occasions/display";

/**
 * Every occasion the signed-in user may see, soonest first.
 *
 * Must run on the USER-SCOPED client. get_upcoming_occasions() takes no viewer
 * parameter and pins itself to requesting_user_id(); the admin client carries
 * no Clerk subject, so the call would return an empty set rather than
 * everything. That is the same contract acceptInvitation() documents.
 *
 * One shared reader for the dashboard, group pages and wishlists, so the
 * "next event" cannot disagree between two screens.
 */
export async function getUpcomingOccasions(
  daysAhead: number = 30
): Promise<
  | { data: UpcomingOccasion[]; error?: never }
  | { error: string; data?: never }
> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_upcoming_occasions", {
    p_days_ahead: daysAhead,
  });

  if (error) {
    console.error("getUpcomingOccasions: RPC failed", error);
    return { error: "Failed to load upcoming occasions." };
  }

  const rows = (data ?? []) as Array<{
    occasion_id: string | null;
    kind: UpcomingOccasion["kind"];
    name: string | null;
    occasion_date: string;
    celebrant_id: string | null;
    celebrant_username: string | null;
    celebrant_display_name: string | null;
    group_id: string | null;
    group_name: string | null;
  }>;

  return {
    data: rows.map((r) => ({
      occasionId: r.occasion_id,
      kind: r.kind,
      name: r.name,
      occasionDate: r.occasion_date,
      celebrantId: r.celebrant_id,
      celebrantUsername: r.celebrant_username,
      celebrantDisplayName: r.celebrant_display_name,
      groupId: r.group_id,
      groupName: r.group_name,
    })),
  };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify against the real database**

Start the app (`npm run dev`), sign in, and confirm from a server log or a
temporary debug render that `getUpcomingOccasions()` returns your own upcoming
birthday if you have one set on your profile. Then confirm a second account
that should NOT see it gets an empty array. Remove any debug render before
committing.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/occasions.ts
git commit -m "feat(occasions): add getUpcomingOccasions server action"
```

---

### Task 5: Group-date create, edit, and delete

**Files:**
- Modify: `lib/actions/occasions.ts`
- Create: `lib/schemas/occasions.ts`

**Interfaces:**
- Consumes: `public.occasions` RLS policies from Task 1.
- Produces:
  - `export const groupDateSchema` (Zod) with fields `name: string`, `occasionDate: string`, `groupId: string`
  - `export async function createGroupDate(input: { groupId: string; name: string; occasionDate: string }): Promise<{ data: { id: string } } | { error: string }>`
  - `export async function updateGroupDate(id: string, input: { name: string; occasionDate: string }): Promise<{ data: { id: string } } | { error: string }>`
  - `export async function deleteGroupDate(id: string): Promise<{ ok: true } | { error: string }>`

- [ ] **Step 1: Write the schema**

Create `lib/schemas/occasions.ts`, matching the Zod style in
`lib/schemas/profile.ts`:

```ts
import { z } from "zod";

export const groupDateSchema = z.object({
  groupId: z.string().uuid(),
  name: z.string().trim().min(1, "Give this occasion a name").max(200),
  // Matches the occasions.occasion_date column and the 'YYYY-MM-DD' shape
  // celebration_date_in_year() validates on the database side.
  occasionDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Please enter a valid date (YYYY-MM-DD)"),
});

export type GroupDateInput = z.infer<typeof groupDateSchema>;
```

- [ ] **Step 2: Add the imports Task 4 did not need**

At the top of `lib/actions/occasions.ts`, add:

```ts
import { revalidatePath } from "next/cache";
import { groupDateSchema } from "@/lib/schemas/occasions";
```

Task 4 created this file with neither — it only read. Both are required by the
writers below, and omitting them is a compile error, not a runtime one.

- [ ] **Step 3: Write the create action**

Append to `lib/actions/occasions.ts`. Each uses the user-scoped client so the
Task 1 policies apply — the insert policy requires `created_by =
requesting_user_id()`, so `created_by` is set explicitly rather than defaulted:

```ts
export async function createGroupDate(input: {
  groupId: string;
  name: string;
  occasionDate: string;
}): Promise<{ data: { id: string }; error?: never } | { error: string; data?: never }> {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated" };

  const parsed = groupDateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid occasion" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("occasions")
    .insert({
      group_id: parsed.data.groupId,
      kind: "group_date" as const,
      name: parsed.data.name,
      occasion_date: parsed.data.occasionDate,
      // Required by the insert policy, which checks it equals
      // requesting_user_id(). Not defaulted in the schema on purpose: a
      // default would be a claim the policy could not verify.
      created_by: userId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 42501 is RLS refusing the insert -- the caller is not a member of that
    // group. Reported as a membership problem, not a generic failure.
    if (error.code === "42501") {
      return { error: "You are not a member of this group" };
    }
    console.error("createGroupDate: insert failed", error);
    return { error: "Failed to create the occasion. Please try again." };
  }

  if (!data) {
    console.error("createGroupDate: no row returned after insert");
    return { error: "Failed to create the occasion. Please try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/groups/${parsed.data.groupId}`);

  return { data: { id: data.id } };
}
```

- [ ] **Step 4: Write the update and delete actions**

Append to `lib/actions/occasions.ts`:

```ts
/**
 * A zero-row result means the occasion does not exist OR the caller may not
 * touch it, and both return the SAME message on purpose. Telling them apart
 * would make this action an oracle for which occasion ids exist -- the same
 * reasoning acceptInvitation() documents for invitation tokens.
 */
export async function updateGroupDate(
  id: string,
  input: { name: string; occasionDate: string }
): Promise<{ data: { id: string }; error?: never } | { error: string; data?: never }> {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated" };

  // groupId is not being changed, so it is not part of this input. Reuse the
  // schema's field rules by parsing the two fields that are.
  const parsed = groupDateSchema
    .pick({ name: true, occasionDate: true })
    .safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid occasion" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("occasions")
    .update({
      name: parsed.data.name,
      occasion_date: parsed.data.occasionDate,
    })
    .eq("id", id)
    .eq("kind", "group_date")
    .select("id, group_id")
    .maybeSingle();

  if (error) {
    console.error("updateGroupDate: update failed", error);
    return { error: "Failed to update the occasion. Please try again." };
  }

  if (!data) {
    return { error: "That occasion no longer exists, or is not yours to edit" };
  }

  revalidatePath("/dashboard");
  if (data.group_id) revalidatePath(`/groups/${data.group_id}`);

  return { data: { id: data.id } };
}

export async function deleteGroupDate(
  id: string
): Promise<{ ok: true; error?: never } | { error: string; ok?: never }> {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated" };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("occasions")
    .delete()
    .eq("id", id)
    .eq("kind", "group_date")
    .select("id, group_id")
    .maybeSingle();

  if (error) {
    console.error("deleteGroupDate: delete failed", error);
    return { error: "Failed to delete the occasion. Please try again." };
  }

  if (!data) {
    return { error: "That occasion no longer exists, or is not yours to delete" };
  }

  revalidatePath("/dashboard");
  if (data.group_id) revalidatePath(`/groups/${data.group_id}`);

  return { ok: true };
}
```

The `.eq("kind", "group_date")` on both is belt-and-braces: the Task 1 policies
already restrict these to group dates, but a celebrated occasion must never be
reachable through a writer meant for group dates.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Verify authorization against the real database**

Signed in as a non-member, call `createGroupDate` for a group you do not belong
to and confirm you get "You are not a member of this group" rather than a
created row. Then confirm a member can create one.

- [ ] **Step 7: Commit**

```bash
git add lib/actions/occasions.ts lib/schemas/occasions.ts
git commit -m "feat(occasions): add group-date create, edit and delete"
```

---

### Task 6: `UpcomingOccasions` component and dashboard surfacing

**Files:**
- Create: `components/occasions/UpcomingOccasions.tsx`
- Modify: `app/(dashboard)/dashboard/page.tsx`

**Interfaces:**
- Consumes: `getUpcomingOccasions()` (Task 4), `occasionLabel` / `daysUntil` / `UpcomingOccasion` (Task 3).
- Produces: `export function UpcomingOccasions({ occasions, limit }: { occasions: UpcomingOccasion[]; limit?: number })`

- [ ] **Step 1: Write the component**

Create `components/occasions/UpcomingOccasions.tsx`:

```tsx
import Link from "next/link";
import { Cake, Heart, Calendar } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { formatMonthDay } from "@/lib/utils/dates";
import {
  occasionLabel,
  daysUntil,
  type UpcomingOccasion,
} from "@/lib/occasions/display";

// Same icon vocabulary DateReminderBanner.tsx already established, so the two
// surfaces do not disagree about what a birthday looks like.
const ICON = {
  birthday: Cake,
  anniversary: Heart,
  group_date: Calendar,
} as const;

function whenLabel(days: number): string {
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

// A giver needs the list, not the group. Celebrated occasions therefore link
// to the celebrant's wishlist; only a group date has nowhere better to go.
function hrefFor(o: UpcomingOccasion): string {
  if (o.kind === "group_date" && o.groupId) return `/groups/${o.groupId}`;
  if (o.celebrantId) return `/wishlist/user/${o.celebrantId}`;
  return "/dashboard";
}

interface UpcomingOccasionsProps {
  occasions: UpcomingOccasion[];
  limit?: number;
}

/**
 * Server-rendered: no "use client", no state, nothing here is interactive.
 *
 * Renders NOTHING claim-derived -- no counts, no "N claimed" badges. This
 * component also renders for list owners, and getMyWishlist strips claim state
 * from owners everywhere else in the app. A count here would leak it back
 * through the side door.
 */
export function UpcomingOccasions({
  occasions,
  limit = 5,
}: UpcomingOccasionsProps) {
  // No empty state. An empty card would compete with the dashboard tiles for
  // attention while saying nothing.
  if (occasions.length === 0) return null;

  return (
    <section className="space-y-3">
      <Heading level="h2">Coming up</Heading>
      <ul className="space-y-2">
        {occasions.slice(0, limit).map((o) => {
          const Icon = ICON[o.kind];
          return (
            <li
              // Derived occasions have no id until phase 2 materializes one,
              // so the key is composed rather than taken from occasionId.
              key={`${o.kind}-${o.occasionId ?? o.celebrantId}-${o.occasionDate}`}
            >
              <Link
                href={hrefFor(o)}
                className="flex items-center gap-3 rounded-lg border border-light-border bg-light-background p-3 hover:border-primary"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-50">
                  <Icon className="h-4 w-4 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <Text className="font-medium">{occasionLabel(o)}</Text>
                  <Text variant="secondary" size="sm">
                    {formatMonthDay(o.occasionDate)} &middot;{" "}
                    {whenLabel(daysUntil(o.occasionDate))}
                    {o.groupName ? ` · ${o.groupName}` : ""}
                  </Text>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
```

Palette tokens (`text-primary`, `bg-primary-50`, `border-light-border`) rather
than raw hex, matching `tailwind.config.ts` and the sweep in commit `eb2c386`.

- [ ] **Step 2: Wire it into the dashboard**

In `app/(dashboard)/dashboard/page.tsx`, call `getUpcomingOccasions()` alongside
the existing `getMyGroups()` / `getMyWishlist()` calls, and render
`<UpcomingOccasions occasions={occasions} limit={5} />` above the `navTiles`
grid so the next event is the first thing on the page.

- [ ] **Step 3: Verify in the running app**

Run `npm run dev`, set a birthday on your profile a few days out, and confirm it
appears on the dashboard with the right label and day count. Confirm the section
disappears entirely when no occasion is within 30 days.

- [ ] **Step 4: Build and commit**

Run: `npx next build`
Expected: compiles successfully.

```bash
git add components/occasions/UpcomingOccasions.tsx app/\(dashboard\)/dashboard/page.tsx
git commit -m "feat(occasions): surface upcoming occasions on the dashboard"
```

---

### Task 7: Group page and wishlist surfacing

**Files:**
- Modify: `app/(dashboard)/groups/[groupId]/page.tsx`
- Modify: `app/(dashboard)/wishlist/page.tsx`
- Modify: `app/(dashboard)/wishlist/user/[userId]/page.tsx`

**Interfaces:**
- Consumes: `getUpcomingOccasions()` (Task 4), `UpcomingOccasions` (Task 6), `occasionLabel` / `daysUntil` (Task 3).
- Produces: nothing new.

- [ ] **Step 1: Group page**

Render `<UpcomingOccasions>` filtered to occasions relevant to this group —
`o.groupId === groupId` for group dates, plus celebrated occasions whose
celebrant is a member of this group. The action already applies visibility, so
filtering here is presentation only and must not attempt any authorization of
its own.

Add a "New occasion" affordance for members that calls `createGroupDate` from
Task 5.

- [ ] **Step 2: Own wishlist**

In `app/(dashboard)/wishlist/page.tsx`, render a single line above the list when
the viewer has an upcoming occasion of their own: "Your birthday is in 12 days"
using `daysUntil`. In phase 1 this is context only — there is no tagging
affordance yet, so do not add a call to action that goes nowhere.

**Do not surface any claim state here.** This is the owner's own list and
`getMyWishlist` deliberately strips claim fields.

- [ ] **Step 3: Someone else's wishlist**

In `app/(dashboard)/wishlist/user/[userId]/page.tsx`, render the occasion
context for that person when one is upcoming — `occasionLabel` plus the date —
so a giver browsing the list knows what they are shopping for.

- [ ] **Step 4: Verify the owner-blindness invariant by hand**

With two accounts: A claims an item on B's list. Sign in as B, open
`/wishlist`, and confirm nothing on the page — including the new occasion
context — reveals that anything is claimed. Record this in the task report.

- [ ] **Step 5: Full verification**

```bash
npx vitest run && npx tsc --noEmit && npx eslint . && npx next build
```

Expected: tests pass, tsc clean, no NEW eslint errors (the repo has 64
pre-existing problems — compare, do not just count), build succeeds.

- [ ] **Step 6: Commit**

```bash
git add app/\(dashboard\)/groups app/\(dashboard\)/wishlist
git commit -m "feat(occasions): surface occasion context on groups and wishlists"
```

---

## Phase 1 done when

- A family member sets a birthday and every other member who may see it gets
  "Mom's Birthday — in 12 days" on the dashboard, the group page, and her
  wishlist, with no cron and no manual setup.
- Someone creates "Christmas 2026" on the family group and it appears for every
  member, and for nobody outside the group.
- `npm run test:rls` passes with `11_occasion_visibility.sql` and
  `12_occasion_derivation.sql` declared and biting.
- A Feb-29 birthday no longer breaks the reminder run.
- No owner can see claim state anywhere, including on the new surfaces.

## Deferred to phase 2

`get_or_create_occasion()` is **not** built here. Nothing in phase 1 can call
it: materialization only becomes necessary when a tag needs a foreign key.
Building it now would be dead code, and the `left join occasions` in
`get_upcoming_occasions` already returns NULL ids until it exists.
