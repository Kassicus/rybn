# Gift-Giving Occasions — Phase 3 (Occasion-Scoped Claiming) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a claim belong to an occasion, so an unfulfilled claim releases when that occasion passes instead of blocking the item forever.

**Architecture:** Claims move out of `wishlist_items` into their own `wishlist_claims` table, labelled with the occasion they were made for. "Active" is computed, not stored; expiry self-heals inside the claim RPC, so no cron exists. Purchase stays terminal on the item.

**Tech Stack:** Supabase Postgres with RLS, Next.js 16.3.2 App Router server actions, Clerk auth via `requesting_user_id()`, Vitest.

**Spec:** `_planning/2026-09-10-gift-giving-occasions-design.md`
**Predecessors:** phase 1 `…-plan.md`, phase 2 `…-phase-2-plan.md` — both merged and deployed.

## The window this plan is walking through

Production holds **0 claims** (`select count(*) from wishlist_items where claimed_by is not null` → 0), 1 wishlist item, 5 users, 1 group date, 2 profile dates. The spec's riskiest step — backfilling live claim data and dropping `wishlist_items.claimed_by` — is therefore **a no-op today**. The first real claim closes this window permanently and turns Task 4 into a data migration. **Do Task 4 early and do not stall on it.**

## One thing the spec assumes that is not true yet

The spec says `get_or_create_occasion()` is called "when a foreign key is genuinely needed: the first tag **or the first claim** for that occasion." Phase 2 narrowed that function to `get_or_create_occasion(p_kind)` — it takes no subject and always materializes the **caller's own** occasion, which was correct for tagging because you only tag your own items.

**Claiming inverts that.** A giver claiming an item on Mom's list needs *Mom's* occasion row, and the phase 2 signature cannot produce it. Task 1 therefore adds a second, differently-guarded materialization path. This was flagged by phase 2's final whole-branch review; it is not a new discovery.

## Global Constraints

Every one of these was learned by shipping a bug for it in phase 1 or 2.

- **Owner-blindness is the product's core privacy promise.** Today it is enforced in application code — `getMyWishlist` (`lib/actions/wishlist.ts:54-62`) strips six columns. Moving claims to their own table lets **RLS** enforce it instead: the item's owner must not be able to read their own items' claim rows at all. That is strictly stronger than a strip list a future caller can forget. Build it that way.
- **Every `create policy` needs an explicit `to authenticated`.** No `TO` clause means `PUBLIC`, which includes `anon`, and the anon key ships to every browser. `supabase/tests/rls/06_anon_has_no_reach.sql` fails the suite if any `public` policy lacks a named role.
- **Policies and function bodies read `(select public.requesting_user_id())`, wrapped** — `baseline:23-27` documents this as load-bearing for the planner.
- **No `security definer` function takes a viewer id parameter.** Pin to `requesting_user_id()`. A *subject* parameter is permitted only where the function gates it — Task 1 takes `p_celebrant_id` and must gate it through `can_view_field`.
- **RLS test files are declared in `supabase/tests/rls/MANIFEST`**; the token is `OK_<filename minus .sql>`, numeric prefix included; `role` resets to the captured `current_user` before the token insert; **the harness rejects `exception when` handlers** and bans them by grep, so a write that must be refused is asserted by row count.
- **Every deliberate break in a not-vacuous proof runs inside `begin; … rollback;`.** A phase 2 agent was killed between break and restore and left a permissive policy live on production. A missing proof is recoverable; a live hole is not.
- **Falsifiability:** for every test, state in the report the code change that would make it fail, **and** what change would not be caught. Four tests in this project have passed while structurally incapable of failing.
- **Never call `getUpcomingOccasions()` on its bare default** — explicit horizon, justified at the call site.
- Migrations run against the **LINKED PRODUCTION project** `xomvbdvvrlbxoyqdsstt`. eslint baseline is 63 problems; compare, don't count.

---

### Task 1: `get_or_create_celebrated_occasion()`

**Files:**
- Create: `supabase/migrations/20260911100000_celebrated_occasion_for_claims.sql`
- Create: `supabase/tests/rls/15_celebrated_materialization.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.occasions`, `public.celebration_date_in_year(text, integer)`, `public.can_view_field(text, text, jsonb)`, the partial index `occasions_celebrant_identity`.
- Produces: `public.get_or_create_celebrated_occasion(p_celebrant_id text, p_kind public.occasion_kind) returns uuid`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: materialize SOMEBODY ELSE'S celebrated occasion, for claiming
-- =============================================================================
--
-- get_or_create_occasion(p_kind) (20260911000000) takes no subject and always
-- materializes the CALLER's occasion. That was right for tagging -- you only
-- tag your own items. Claiming inverts it: a giver claiming an item on Mom's
-- list needs MOM's occasion row, and that signature cannot produce one.
--
-- So this function DOES take a subject, and therefore has to earn it. The
-- guard is the same one the read path uses: can_view_field() against the
-- celebrant's own privacy settings for that date. A caller who cannot SEE
-- somebody's birthday cannot materialize an occasion for it -- otherwise this
-- becomes an existence oracle for dates the privacy model hides, and worse, a
-- way to plant rows referencing people you have no relationship with.
--
-- It derives the date itself rather than accepting one, for the same reason
-- 20260911000000 does: a p_date parameter would let a caller forge an occasion
-- on a date the celebrant never entered.
create or replace function public.get_or_create_celebrated_occasion(
  p_celebrant_id text,
  p_kind public.occasion_kind
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_year   integer := extract(year from current_date)::integer;
  v_row    record;
  v_date   date;
  v_id     uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- A group_date is created explicitly by a person; there is nothing to derive.
  if p_kind = 'group_date' then
    raise exception 'group dates are created explicitly, not materialized'
      using errcode = '22023';
  end if;

  select pi.field_value, pi.privacy_settings into v_row
  from profile_info pi
  where pi.user_id = p_celebrant_id
    and pi.category = 'dates'
    and pi.field_name = p_kind::text;

  -- Same message whether the date does not exist or the caller may not see it.
  -- Distinguishing them would make this an oracle for which dates are on file,
  -- which is exactly what can_view_field exists to prevent.
  if v_row is null
     or not public.can_view_field(p_celebrant_id, v_caller, v_row.privacy_settings)
  then
    raise exception 'no visible % for that person' , p_kind
      using errcode = '22023';
  end if;

  v_date := public.celebration_date_in_year(v_row.field_value, v_year);
  if v_date is null then
    raise exception 'stored % is not a usable date', p_kind
      using errcode = '22023';
  end if;
  if v_date < current_date then
    v_date := public.celebration_date_in_year(v_row.field_value, v_year + 1);
  end if;

  insert into public.occasions (kind, celebrant_id, occasion_date, created_by)
  values (p_kind, p_celebrant_id, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do update set occasion_date = excluded.occasion_date
  returning id into v_id;

  if v_id is null then
    raise exception 'failed to materialize % for %', p_kind, p_celebrant_id
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

grant execute on function
  public.get_or_create_celebrated_occasion(text, public.occasion_kind)
  to authenticated, service_role;
```

- [ ] **Step 2: Apply**

Run: `npx supabase db push`. A classifier refusal is not a failure — retry the identical command, never something more destructive.

- [ ] **Step 3: Write the RLS test**

Create `supabase/tests/rls/15_celebrated_materialization.sql`, counter-gated, token `OK_15_celebrated_materialization`, `role` reset before the token insert. Assert:

1. a caller who **can** see the celebrant's birthday materializes exactly one row, with `celebrant_id` = the celebrant (not the caller) and `created_by` = the caller;
2. calling twice returns the same uuid and leaves one row;
3. a caller who **cannot** see it (privacy `{"visibleToGroupTypes": []}` — this schema's spelling of private) creates **no** row. Assert by row count, not by catching;
4. `created_by` being the caller while `celebrant_id` is someone else is the shape that distinguishes this from `get_or_create_occasion` — assert both columns explicitly, or a swapped implementation passes.

- [ ] **Step 4: Declare it** in `supabase/tests/rls/MANIFEST`.

- [ ] **Step 5: Run and prove it bites**

`npm run test:rls` green. Then, **inside a rolled-back transaction**, remove the `can_view_field` conjunct from a scratch copy of the function, confirm assertion 3 fails, and let the rollback restore it. Paste both outputs.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260911100000_celebrated_occasion_for_claims.sql \
        supabase/tests/rls/15_celebrated_materialization.sql supabase/tests/rls/MANIFEST
git commit -m "feat(claims): materialize another person's occasion, privacy-gated"
```

---

### Task 2: `wishlist_claims` table

**Files:**
- Create: `supabase/migrations/20260911100001_wishlist_claims.sql`
- Create: `supabase/tests/rls/16_claim_visibility.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.wishlist_items`, `public.occasions`, `public.can_view_wishlist_item(text, text, jsonb)`.
- Produces: table `public.wishlist_claims (id uuid, item_id uuid, occasion_id uuid, claimed_by text, claimed_at timestamptz, released_at timestamptz, created_at timestamptz)`; partial unique index `wishlist_claims_one_active`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: claims, scoped to the occasion they were made for
-- =============================================================================
--
-- ONE ACTIVE CLAIM PER ITEM, not one per occasion. If exclusion were
-- per-occasion, the same headphones could be claimed for Mom's birthday by one
-- person and for Christmas by another at the same time -- two people buying
-- the same thing, which is the exact failure claiming exists to prevent. The
-- occasion LABELS the claim and decides when it lapses; it does not partition
-- the exclusion.
--
-- OWNER-BLINDNESS IS ENFORCED HERE, not in application code. Until this
-- migration, getMyWishlist() stripped six columns before returning
-- (lib/actions/wishlist.ts) -- correct, but a rule a future caller can forget.
-- A separate table lets RLS say it instead: the item's owner is excluded from
-- the SELECT policy, so there is no query they can write that returns their
-- own items' claims. The surprise is the product; make it structural.
create table public.wishlist_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  -- on delete SET NULL, not cascade: deleting an occasion must not destroy the
  -- record of who claimed what. The claim survives as an unscoped one, which
  -- by the rule below simply never auto-releases.
  occasion_id uuid references public.occasions(id) on delete set null,
  claimed_by text not null references public.user_profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.wishlist_claims is
  'One active claim per item, labelled with the occasion it was made for. Never readable by the item''s owner.';

-- The race backstop. Active-ness is computed on read (released_at is null AND
-- the occasion has not passed), but an index cannot see another table or
-- current_date -- so this enforces the weaker invariant and claim_wishlist_item()
-- closes the gap by releasing lapsed claims before it inserts.
create unique index wishlist_claims_one_active
  on public.wishlist_claims (item_id) where released_at is null;

create index wishlist_claims_by_claimer
  on public.wishlist_claims (claimed_by) where released_at is null;

alter table public.wishlist_claims enable row level security;

-- Readable by anyone who can see the item EXCEPT its owner. The owner
-- exclusion is the whole point: see the header.
create policy "Claims are visible to everyone but the item's owner"
  on public.wishlist_claims for select to authenticated
  using (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_claims.item_id
        and wi.user_id <> (select public.requesting_user_id())
        and public.can_view_wishlist_item(
          wi.user_id, (select public.requesting_user_id()), wi.privacy_settings)
    )
  );

-- Writes go through claim_wishlist_item() / release_wishlist_claim(), which are
-- SECURITY DEFINER (Task 3). No INSERT or UPDATE policy exists, deliberately:
-- a direct insert could not perform the lapsed-claim release the unique index
-- requires, so it would fail confusingly rather than safely. Absent a policy,
-- direct writes fail closed.

grant select on public.wishlist_claims to authenticated;
grant select, insert, update on public.wishlist_claims to service_role;
```

- [ ] **Step 2: Apply.** `npx supabase db push`

- [ ] **Step 3: Write the RLS test**

`supabase/tests/rls/16_claim_visibility.sql`, token `OK_16_claim_visibility`. Assert, each falsifiable:

1. a co-member who can see the item **sees** a claim on it;
2. the item's **owner** sees **zero** claims on their own item — the headline invariant;
3. a stranger who cannot see the item sees zero;
4. a direct `insert` by an authenticated caller creates no row (no INSERT policy). Assert by row count.

Assertion 2 is the one that must not pass vacuously: assertion 1 proves the row is readable by *somebody*, so 2 is measuring the owner exclusion rather than an empty table.

- [ ] **Step 4: Declare it** in MANIFEST.

- [ ] **Step 5: Run and prove it bites.** Inside a rolled-back transaction, drop the `wi.user_id <> …` conjunct, confirm assertion 2 fails, let the rollback restore it.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260911100001_wishlist_claims.sql \
        supabase/tests/rls/16_claim_visibility.sql supabase/tests/rls/MANIFEST
git commit -m "feat(claims): add wishlist_claims with owner-blind RLS"
```

---

### Task 3: `claim_wishlist_item()` and `release_wishlist_claim()`

**Files:**
- Create: `supabase/migrations/20260911100002_claim_rpcs.sql`
- Create: `supabase/tests/rls/17_claim_lifecycle.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.wishlist_claims`, `public.occasions`, `public.can_view_wishlist_item`.
- Produces:
  - `public.claim_wishlist_item(p_item_id uuid, p_occasion_id uuid) returns uuid`
  - `public.release_wishlist_claim(p_item_id uuid) returns boolean`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: claiming, with lapsed claims self-healing on write
-- =============================================================================
--
-- A claim is ACTIVE when released_at is null AND (occasion_id is null OR the
-- occasion has not passed). Reads use that definition directly, so a lapsed
-- claim never renders as live.
--
-- Writes cannot: wishlist_claims_one_active only sees `released_at is null`,
-- so a lapsed row would block a new claim forever. This function therefore
-- releases lapsed claims on the item FIRST, then inserts -- both in one
-- transaction, with the unique index as the race backstop. That is why no
-- release cron exists and none is needed.
create or replace function public.claim_wishlist_item(
  p_item_id uuid,
  p_occasion_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_owner  text;
  v_privacy jsonb;
  v_purchased boolean;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select wi.user_id, wi.privacy_settings, wi.purchased
    into v_owner, v_privacy, v_purchased
  from wishlist_items wi where wi.id = p_item_id;

  -- One message for "no such item" and "you cannot see it", so this is not an
  -- existence oracle for other people's private items.
  if v_owner is null
     or not public.can_view_wishlist_item(v_owner, v_caller, v_privacy)
  then
    raise exception 'that item is not available to claim' using errcode = '22023';
  end if;

  if v_owner = v_caller then
    raise exception 'you cannot claim your own item' using errcode = '22023';
  end if;

  -- Purchase is terminal: a bought item accepts no new claims.
  if v_purchased then
    raise exception 'that item has already been purchased' using errcode = '22023';
  end if;

  -- The occasion, when given, must be one the caller can actually SEE -- not
  -- merely one that exists. This is SECURITY DEFINER, so `occasions`' own RLS
  -- does not apply here and the check has to be written out. An existence-only
  -- check would let any authenticated caller label a claim with any occasion
  -- id, including one belonging to somebody whose dates they cannot see --
  -- and since the occasion's date decides when the claim auto-releases, that
  -- is a forged label with real consequences, not a cosmetic one.
  --
  -- Two shapes, two gates, matching how the occasion itself is protected:
  -- a celebrated occasion follows its celebrant's own privacy settings for
  -- that date (can_view_field, the same gate get_upcoming_occasions uses), and
  -- a group_date follows group membership.
  --
  -- Note this is belt-and-braces in the normal flow: claimItem() calls
  -- get_or_create_celebrated_occasion() first, which already gates on
  -- can_view_field. But this function is granted to `authenticated` and so is
  -- reachable directly through PostgREST, where nothing upstream has run.
  if p_occasion_id is not null and not exists (
    select 1 from occasions o
     where o.id = p_occasion_id
       and o.celebrant_id is not null
       and exists (
         select 1 from profile_info pi
          where pi.user_id = o.celebrant_id
            and pi.category = 'dates'
            and pi.field_name = o.kind::text
            and public.can_view_field(o.celebrant_id, v_caller, pi.privacy_settings)
       )
    union all
    select 1 from occasions o
     where o.id = p_occasion_id
       and o.group_id is not null
       and public.is_group_member(o.group_id, v_caller)
  ) then
    -- Same message for "does not exist" and "you cannot see it", so this is
    -- not an existence oracle for other people's occasions.
    raise exception 'that occasion is not available' using errcode = '22023';
  end if;

  -- Release anything lapsed on this item before inserting. This is the step
  -- that makes "active is computed" and "one active claim" agree.
  update wishlist_claims c
     set released_at = now()
   where c.item_id = p_item_id
     and c.released_at is null
     and c.occasion_id is not null
     and exists (
       select 1 from occasions o
       where o.id = c.occasion_id and o.occasion_date < current_date
     );

  insert into wishlist_claims (item_id, occasion_id, claimed_by)
  values (p_item_id, p_occasion_id, v_caller)
  returning id into v_id;

  return v_id;
exception
  -- The unique index fired: somebody else holds a live claim. Report it as the
  -- product fact it is, not as a constraint name.
  when unique_violation then
    raise exception 'somebody has already claimed that item' using errcode = '22023';
end;
$$;

-- Releasing your own claim. Returns false when there was nothing to release,
-- rather than raising -- an unclaim that finds nothing is not an error.
create or replace function public.release_wishlist_claim(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_count integer;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update wishlist_claims
     set released_at = now()
   where item_id = p_item_id
     and claimed_by = v_caller
     and released_at is null;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

grant execute on function public.claim_wishlist_item(uuid, uuid) to authenticated, service_role;
grant execute on function public.release_wishlist_claim(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Apply.** `npx supabase db push`

- [ ] **Step 3: Write the RLS test**

`supabase/tests/rls/17_claim_lifecycle.sql`, token `OK_17_claim_lifecycle`. Assert:

1. a co-member claims a visible item and exactly one active row results;
2. a **second** claimer on the same item creates **no** additional active row (the exclusion holds);
3. a claim whose occasion is **in the past** is released by a subsequent claim, and the new claim succeeds — this is the self-healing path and the reason the function exists;
4. the owner claiming their own item creates no row;
5. `release_wishlist_claim` by the claimer sets `released_at`, and a fresh claim then succeeds;
6. `release_wishlist_claim` by a **different** user releases nothing;
7. claiming with an `p_occasion_id` the caller **cannot see** — a celebrated
   occasion whose celebrant's date is private to them — creates no claim row.
   This is the assertion for the visibility gate above; an existence-only
   implementation passes every other assertion in this file.

For assertion 3, build the fixture with an occasion dated in the past explicitly — do not rely on a date that happens to have passed.

- [ ] **Step 4: Declare it** in MANIFEST.

- [ ] **Step 5: Run and prove it bites.** Inside a rolled-back transaction, remove the lapsed-release `update` from a scratch copy, confirm assertion 3 fails, let the rollback restore it.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260911100002_claim_rpcs.sql \
        supabase/tests/rls/17_claim_lifecycle.sql supabase/tests/rls/MANIFEST
git commit -m "feat(claims): claim and release RPCs with self-healing expiry"
```

---

### Task 4: The cutover — drop the old claim columns

**This is the task the window is open for. Do it without stalling.**

**Files:**
- Create: `supabase/migrations/20260911100003_drop_item_claim_columns.sql`
- Modify: `supabase/tests/rls/09_privacy_pins.sql`
- Modify: `types/database.ts`

**Interfaces:**
- Consumes: `public.wishlist_claims` (Task 2).
- Produces: `wishlist_items` without `claimed_by` / `claimed_at`; `pin_wishlist_item_owner_fields` recreated without them.

- [ ] **Step 1: Confirm the window is still open**

Run against the linked project:

```sql
select count(*) as live_claims from wishlist_items where claimed_by is not null;
```

**Expected: 0.** If it is not 0, STOP and report — the backfill below is written as a no-op and a non-zero count means real claims exist that this plan has not designed a migration for.

- [ ] **Step 2: Write the migration**

```sql
-- =============================================================================
-- rybn: move claims off wishlist_items
-- =============================================================================
--
-- Backfill first, then drop. The backfill is a no-op today (production held 0
-- claimed items when this was written, verified in the step above) but it is
-- written correctly anyway: if this ever runs against a database that does
-- have claims, they survive as UNSCOPED claims -- occasion_id null, which by
-- claim_wishlist_item()'s rule never auto-releases. That preserves today's
-- behaviour exactly for claims made before occasions existed.
insert into public.wishlist_claims (item_id, occasion_id, claimed_by, claimed_at)
select wi.id, null, wi.claimed_by, coalesce(wi.claimed_at, now())
from public.wishlist_items wi
where wi.claimed_by is not null;

-- The trigger's permitted-column list is the contract for what a NON-owner may
-- change on somebody else's item. claimed_by/claimed_at are leaving the table,
-- so they leave the list; purchased, out_of_stock and updated_at stay, because
-- a non-owner still writes those.
--
-- supabase/tests/rls/09_privacy_pins.sql asserts this trigger definition as an
-- exact string and is updated in the same commit. A migration that changes a
-- pinned contract without updating its assertion is how the assertion quietly
-- stops meaning anything.
drop trigger if exists pin_wishlist_item_owner_fields on public.wishlist_items;

create trigger pin_wishlist_item_owner_fields
  before update on public.wishlist_items
  for each row execute function public.reject_non_owner_column_change(
    'purchased', 'purchased_at',
    'out_of_stock_marked_by', 'out_of_stock_marked_at', 'updated_at');

-- "Users can claim visible wishlist items" STAYS. Its name is now slightly
-- wrong -- it no longer governs claiming -- but it is what still lets a
-- non-owner mark an item purchased or out of stock, and renaming a policy
-- means dropping and recreating it for no behavioural gain.
comment on table public.wishlist_items is
  'Wishlist items. Claims live in wishlist_claims as of 20260911100003; the "Users can claim visible wishlist items" policy now governs purchased/out_of_stock only.';

drop index if exists public.idx_wishlist_items_claimed_by;

alter table public.wishlist_items drop column claimed_by;
alter table public.wishlist_items drop column claimed_at;
```

- [ ] **Step 3: Apply.** `npx supabase db push`

- [ ] **Step 4: Update the pin assertion**

In `supabase/tests/rls/09_privacy_pins.sql`, line ~115 asserts the trigger definition verbatim. Update the expected string to the five-column list above. Its claim-path assertion at ~line 352 (`set claimed_by = 'user_pp_peer'`) references a column that no longer exists — rewrite it to exercise `purchased` instead, which is the nearest surviving non-owner write, and update the failure message so it names what it now tests.

- [ ] **Step 5: Update the types**

Remove `claimed_by` / `claimed_at` from `wishlist_items` in `types/database.ts` and add `wishlist_claims` plus the three new functions to the `Functions` block. **Hand-edit — never regenerate**: four `StoredImageValue` annotations are load-bearing and `lib/storage/image-value.ts` fails to compile without them.

- [ ] **Step 6: Run the suite**

`npm run test:rls` — all files pass, including the updated `09_privacy_pins.sql`. `npx tsc --noEmit` will now fail wherever application code still reads the dropped columns; that is expected and Task 5 fixes it. Note the failures in your report; do not fix them here.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260911100003_drop_item_claim_columns.sql \
        supabase/tests/rls/09_privacy_pins.sql types/database.ts
git commit -m "feat(claims): move claims off wishlist_items"
```

---

### Task 5: Server actions

**Files:**
- Modify: `lib/actions/wishlist.ts`
- Create: `lib/actions/claims.ts`
- Create: `lib/actions/claims.test.ts`

**Interfaces:**
- Consumes: `claim_wishlist_item(uuid, uuid)`, `release_wishlist_claim(uuid)`, `get_or_create_celebrated_occasion(text, occasion_kind)`.
- Produces:
  - `claimItem(itemId: string, celebrantId: string, kind: "birthday" | "anniversary" | null): Promise<{ data: { claimId: string } } | { error: string }>`
  - `releaseClaim(itemId: string): Promise<{ ok: boolean } | { error: string }>`
  - `getActiveClaims(itemIds: string[]): Promise<{ data: Record<string, { claimedBy: string; occasionId: string | null }> } | { error: string }>`

- [ ] **Step 1: Write the failing tests**

`lib/actions/claims.test.ts`, following the mocked-Supabase pattern in `lib/actions/occasions.test.ts`. Cover: `claimItem` materializes the celebrant's occasion then claims, in that order; a `22023` from the claim RPC returns the RPC's own user-facing message rather than a generic one; `claimItem` with `kind: null` claims **unscoped** without calling the materialization RPC; `getActiveClaims([])` returns `{}` **without** touching the database; `releaseClaim` returning false yields `{ ok: false }` rather than an error; signed out returns `{ error: "Not authenticated" }` without a database call.

- [ ] **Step 2: Run, confirm they fail** — `npx vitest run lib/actions/claims.test.ts`, cannot resolve `./claims`.

- [ ] **Step 3: Write `lib/actions/claims.ts`**

A `"use server"` module exporting exactly the three functions above. Use the **user-scoped** client — the RPCs pin to `requesting_user_id()` and the admin client carries no Clerk subject. Log provider detail server-side; the RPC messages above are already written for end users, so pass those through rather than replacing them with a generic string.

- [ ] **Step 4: Rewrite the old actions in `lib/actions/wishlist.ts`**

Delete `claimWishlistItem`, `unclaimWishlistItem`, `getClaimerProfile` and `getClaimerProfiles`; their callers move to `lib/actions/claims.ts`. **Remove `claimed_by` and `claimed_at` from `getMyWishlist`'s strip list** — the columns are gone and RLS now enforces owner-blindness structurally. Leave `purchased`, `purchased_at` and the two `out_of_stock` columns in the strip list; those still exist and still must be hidden from the owner.

- [ ] **Step 5: Verify** — `npx vitest run`, `npx tsc --noEmit` clean, eslint no worse than 63.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/claims.ts lib/actions/claims.test.ts lib/actions/wishlist.ts
git commit -m "feat(claims): occasion-scoped claim actions"
```

---

### Task 6: Claim UI

**Files:**
- Modify: `components/wishlist/ClaimActions.tsx`
- Modify: `components/wishlist/WishlistItemCard.tsx`
- Modify: `app/(dashboard)/wishlist/user/[userId]/page.tsx`
- Modify: `app/(dashboard)/wishlist/[itemId]/page.tsx`

**Interfaces:**
- Consumes: `claimItem`, `releaseClaim`, `getActiveClaims` (Task 5); `getUpcomingOccasions` and `occasionLabel` from phase 1.

- [ ] **Step 1: Rework `ClaimActions`**

It currently calls `claimWishlistItem(itemId)`. It must now pass the occasion the claim is for: on a viewer's wishlist page the occasion in view is already computed (`app/(dashboard)/wishlist/user/[userId]/page.tsx`), so pass that celebrant and kind. When there is no occasion in view, claim **unscoped** by passing `kind: null` — an unscoped claim never auto-releases, which is the honest behaviour when nobody can say what occasion it is for.

Surface the RPC's message verbatim on failure; it is already written for the person reading it ("somebody has already claimed that item", "that item has already been purchased").

- [ ] **Step 2: Replace the orphaned claimer data path**

Task 5 deletes `getClaimerProfile` and `getClaimerProfiles`, and `item.claimed_by` no longer exists after Task 4 — so every one of these call sites is broken until you rewire it. They are listed exactly because a "Consumes: getActiveClaims" line in an Interfaces block is not a step, and phase 1 shipped a bug through precisely that gap:

- `app/(dashboard)/wishlist/[itemId]/page.tsx:12,134` — imports and calls `getClaimerProfile(itemData.claimed_by)`.
- `app/(dashboard)/wishlist/user/[userId]/page.tsx:3,134` — imports and calls `getClaimerProfiles(uniqueClaimerIds)`, where the ids come from `item.claimed_by`.
- `components/wishlist/SortableWishlistItems.tsx:170` — `claimerInfo={item.claimed_by ? claimerProfiles[item.claimed_by] : null}`.

Replace all three with `getActiveClaims(itemIds)`, which returns `Record<itemId, { claimedBy, occasionId }>` keyed by item rather than by claimer id. `WishlistItemCard`'s `claimerInfo` prop shape (`components/wishlist/WishlistItemCard.tsx:47`) can stay if you resolve the display name separately — but note the profile lookup that `getClaimerProfiles` did is no longer bundled, so decide deliberately whether the claimer's name is still shown and say which you chose in your report.

**The owner's own list must not call `getActiveClaims` at all.** RLS would return nothing anyway, but a call that always returns `{}` is a call somebody later "fixes" by widening the policy.

- [ ] **Step 3: Show the claim's occasion**

Where the UI currently shows "Claimed", show what it was claimed for when the claim carries an occasion — "Claimed for Mom's Birthday". Use `occasionLabel`. **Never render this on the owner's own list**; RLS returns no claims there, so the data will be absent, but the component must not assume that and render an empty state where the owner would notice a gap.

- [ ] **Step 4: Verify** — `npx vitest run`, `npx tsc --noEmit`, `npx next build` green; eslint no worse than 63. Task 4 deliberately left `tsc` failing on the dropped columns; this is where those failures must reach zero.

- [ ] **Step 5: Manual check, and say plainly it was done**

Two accounts: A claims an item on B's list for B's birthday. Confirm A sees "Claimed for …" and B's own `/wishlist` shows no claim indication of any kind. **This is the owner-blindness check outstanding since phase 1** — with claims now enforced by RLS rather than a strip list, it is checking a genuinely different mechanism. If you cannot run it, say so explicitly rather than implying it passed.

- [ ] **Step 6: Commit**

```bash
git add components/wishlist app/\(dashboard\)/wishlist
git commit -m "feat(claims): show what a claim was made for"
```

---

## Phase 3 done when

- Claiming an item during someone's birthday records the claim against that occasion, and the claim releases on its own once the date passes unfulfilled.
- A second person cannot claim an item somebody already holds.
- Purchase remains terminal.
- An item's owner cannot see claims on their own items **by any query** — not because a strip list removed them.
- `npm run test:rls` passes with `15`, `16` and `17` declared and proven to bite.

## Out of scope

- Any UI for browsing "what is claimed for this occasion" across a group — that is the group-date read path phase 2 declared deferred, and it needs the roster design decision first.
- Backfilling `occasion_id` onto claims migrated as unscoped. They never auto-release, deliberately.
- The annual tag debris question — what should happen to last year's tags after a birthday passes. A product decision, still open.
