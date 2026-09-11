# Shared Anniversaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A couple in the same group links their anniversaries so the pair sees one occasion, one claim scope and one reminder instead of two.

**Architecture:** A new `anniversary_links` table stores the pair canonically (`user_a < user_b`). `occasions` gains `partner_id`, and every linked couple materializes under the canonical partner, so the existing `occasions_celebrant_identity` index is untouched. `get_or_create_celebrated_occasion` resolves either partner to that one row, which is what makes tagging and claiming share an occasion. Reads collapse per viewer: both names only when the viewer can see both dates.

**Tech Stack:** Postgres + RLS on Supabase (linked production project `xomvbdvvrlbxoyqdsstt`), Clerk auth via `requesting_user_id()`, Next.js App Router, Vitest, the `scripts/test-rls.sh` harness.

**Spec:** `_planning/2026-09-11-shared-anniversaries-design.md`

## Global Constraints

Every one was learned by shipping a bug for it in phases 1–3.

- **Every `create policy` needs an explicit `to authenticated`.** No `TO` clause means `PUBLIC`, which includes `anon`, whose key ships to every browser. `supabase/tests/rls/06_anon_has_no_reach.sql` fails the suite if any `public` policy lacks a named role.
- **Every new table needs an explicit `revoke insert, update, delete … from authenticated`.** Supabase's per-role default privileges grant `authenticated` every DML verb on any new table in `public` regardless of the table's own `grant` line — `pg_default_acl` shows `authenticated=arwdm`. Without the revoke, a privilege assertion tests something already false.
- **Every write RPC is `SECURITY DEFINER`.** After that revoke, a `SECURITY INVOKER` function fails with a bare `42501` before RLS is ever consulted.
- **No `security definer` function takes a viewer id parameter.** Pin to `requesting_user_id()`. A *subject* parameter is permitted only where the function gates it.
- **Policies and function bodies read `(select public.requesting_user_id())`, wrapped** — load-bearing for the planner.
- **RLS test files are declared in `supabase/tests/rls/MANIFEST`**; token is `OK_<filename minus .sql>`; `role` resets to the captured `current_user` before the token insert.
- **The harness rejects `exception when` handlers** by grep (`scripts/test-rls.sh:276-279`), scanning **comment-stripped** source (`:249`). A denial that RAISES cannot be asserted live — it aborts the whole file's batch. Assert those as anchored source checks instead.
- **Anchored source checks:** every regex carries its **own** `(?n)` and is line-anchored; `pg_proc` lookups are scoped by exact `::regprocedure`; and each file matching function source carries a `position('/*' in definition) = 0` floor, because line-anchoring does not stop a block comment.
- **Every deliberate break in a proof runs inside `begin; … rollback;`**, with the `rollback` BEFORE any diagnostic `raise`.
- **Falsifiability:** for every test, state in the report the change that would make it fail **and** what would not be caught.
- **Any date-dependent fixture uses a pinned clock or a fixed calendar anchor.** Phase 3 lost two review rounds to derived fixtures that only exercised their branch part of the year.
- **Never call `getUpcomingOccasions()` on its bare default** — explicit horizon, justified at the call site.
- Migrations run against the **LINKED PRODUCTION project** `xomvbdvvrlbxoyqdsstt`, applied only with `npx supabase db push`. eslint baseline is 61 problems; compare, don't count.
- **`types/database.ts` is hand-edited, never regenerated** — four `StoredImageValue` annotations are load-bearing and `lib/storage/image-value.ts` fails to compile without them.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260912000000_anniversary_links.sql` | the table, its RLS, grants and revoke |
| `supabase/migrations/20260912000001_occasion_partner.sql` | `occasions.partner_id` + the widened SELECT policy |
| `supabase/migrations/20260912000002_anniversary_link_rpcs.sql` | request / confirm / decline / unlink |
| `supabase/migrations/20260912000003_canonical_anniversary.sql` | canonicalisation inside `get_or_create_celebrated_occasion` |
| `supabase/migrations/20260912000004_derivation_partner.sql` | `get_upcoming_occasions` drop + recreate with partner columns |
| `supabase/tests/rls/18_anniversary_links.sql` | table visibility + privilege inventory |
| `supabase/tests/rls/19_anniversary_link_rpcs.sql` | RPC authorization + confirm's date sync and reconciliation |
| `supabase/tests/rls/20_shared_anniversary_reads.sql` | the widened policy, canonicalisation, derivation collapse |
| `lib/occasions/display.ts` | `UpcomingOccasion` gains partner fields; `occasionLabel` renders both names |
| `lib/actions/anniversary-links.ts` | server actions over the four RPCs |
| `components/profile/AnniversaryPartner.tsx` | link state + picker, rendered beside `DatesSection` |
| `components/notifications/NotificationsList.tsx` | renders a pending link request with Confirm / Decline |

---

### Task 1: `anniversary_links` table

**Files:**
- Create: `supabase/migrations/20260912000000_anniversary_links.sql`
- Create: `supabase/tests/rls/18_anniversary_links.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.user_profiles(id)`, `public.requesting_user_id()`.
- Produces: table `public.anniversary_links (id uuid, user_a text, user_b text, status text, initiated_by text, agreed_date text, created_at timestamptz, confirmed_at timestamptz)`; canonical ordering `user_a < user_b`; partial unique indexes `anniversary_links_one_confirmed_a` / `_b`.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: a confirmed pair of people who share one anniversary
-- =============================================================================
--
-- Stored CANONICALLY -- user_a is always the lexicographically smaller id --
-- and that is a CHECK rather than a convention, because canonicalisation is
-- what lets occasions_celebrant_identity (kind, celebrant_id, occasion_year)
-- keep working unchanged for a couple. A pair stored either way round would
-- produce two occasion rows for one event, which is the entire defect this
-- feature exists to remove.
create table public.anniversary_links (
  id uuid primary key default gen_random_uuid(),
  user_a text not null references public.user_profiles(id) on delete cascade,
  user_b text not null references public.user_profiles(id) on delete cascade,
  status text not null default 'pending',
  initiated_by text not null references public.user_profiles(id) on delete cascade,
  -- Captured when the request is made, so the confirmation prompt can name the
  -- date and accepting can apply it. Deliberately a snapshot: if the initiator
  -- edits their own anniversary before the partner confirms, both still end up
  -- agreeing with each other -- on the date the prompt actually showed.
  agreed_date text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint anniversary_links_canonical check (user_a < user_b),
  constraint anniversary_links_status check (status in ('pending', 'confirmed')),
  constraint anniversary_links_distinct check (user_a <> user_b)
);

comment on table public.anniversary_links is
  'A pair of people who share one anniversary. user_a is always the lexicographically smaller id; occasions for the pair materialize under user_a.';

create unique index anniversary_links_pair
  on public.anniversary_links (user_a, user_b);

-- One CONFIRMED link per person, from either side. Pending requests are
-- deliberately unconstrained: a pending row is an invitation, not a claim, and
-- refusing a second one would let the first requester block everybody else.
create unique index anniversary_links_one_confirmed_a
  on public.anniversary_links (user_a) where status = 'confirmed';
create unique index anniversary_links_one_confirmed_b
  on public.anniversary_links (user_b) where status = 'confirmed';

alter table public.anniversary_links enable row level security;

-- Readable only by its two participants. Nobody else needs to read it
-- directly: get_upcoming_occasions is SECURITY DEFINER and resolves links on
-- the caller's behalf, so a third party learns a couple is linked only through
-- an occasion they were already entitled to see.
create policy "Participants can see their own anniversary links"
  on public.anniversary_links for select to authenticated
  using (
    user_a = (select public.requesting_user_id())
    or user_b = (select public.requesting_user_id())
  );

-- Writes go through the SECURITY DEFINER RPCs in 20260912000002. No INSERT,
-- UPDATE or DELETE policy exists, deliberately: a direct write could not
-- enforce canonical ordering, the shared-group requirement, or the date sync,
-- so it would fail confusingly rather than safely.
grant select on public.anniversary_links to authenticated;
grant select, insert, update, delete on public.anniversary_links to service_role;

-- Supabase's per-role default privileges grant `authenticated` every DML verb
-- on any NEW table in public regardless of the grant line above -- verified in
-- phase 3, where pg_default_acl showed `authenticated=arwdm`. Without this the
-- privilege assertions in 18_anniversary_links.sql would be testing something
-- already false.
revoke insert, update, delete on public.anniversary_links from authenticated;
```

- [ ] **Step 2: Apply.** `npx supabase db push`

- [ ] **Step 3: Write the RLS test**

`supabase/tests/rls/18_anniversary_links.sql`, token `OK_18_anniversary_links`. Assert, each falsifiable:

1. `user_a` sees their own link row;
2. `user_b` sees the same row — proves the policy admits BOTH sides, not just the initiator;
3. a third user who is in the same group sees **zero** — shared-group membership must not grant visibility of somebody else's link;
4. `has_table_privilege('authenticated','public.anniversary_links','INSERT')` is false, likewise UPDATE and DELETE;
5. zero policies with `cmd` in (`INSERT`,`UPDATE`,`DELETE`,`ALL`), and exactly one `SELECT` policy scoped `permissive = 'PERMISSIVE'`.

Assertion 3 is the one that must not pass vacuously: assertion 1 proves somebody can read the row, so 3 measures the exclusion rather than an empty table.

Write fixtures as the connecting (RLS-bypassing) role — after the revoke there is no other way to insert here.

- [ ] **Step 4: Declare it** in `supabase/tests/rls/MANIFEST` (append `18_anniversary_links.sql`).

- [ ] **Step 5: Prove it bites.** Inside `begin; … rollback;`, replace the SELECT policy with one gating only on `user_a`, confirm assertion 2 fails, let the rollback restore it. Put the `rollback` before any diagnostic `raise`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260912000000_anniversary_links.sql \
        supabase/tests/rls/18_anniversary_links.sql supabase/tests/rls/MANIFEST
git commit -m "feat(anniversaries): add anniversary_links with participant-only RLS"
```

---

### Task 2: `occasions.partner_id` and the widened SELECT policy

**Files:**
- Create: `supabase/migrations/20260912000001_occasion_partner.sql`
- Create: `supabase/tests/rls/20_shared_anniversary_reads.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.occasions`, `public.can_view_field(text, text, jsonb)`.
- Produces: `occasions.partner_id text` (nullable, `on delete set null`); the SELECT policy `"Celebrated occasions follow the underlying date's privacy"` replaced in place, same name.

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: a celebrated occasion may belong to two people
-- =============================================================================
alter table public.occasions
  add column partner_id text references public.user_profiles(id) on delete set null;

comment on column public.occasions.partner_id is
  'The non-canonical half of a linked couple. Null for every unshared occasion. celebrant_id is always the canonical (lexicographically smaller) partner.';

-- WHY THIS POLICY HAS TO CHANGE, stated because widening a privacy policy is
-- the riskiest thing in this feature.
--
-- A linked couple materializes ONE row, keyed to the canonical partner. Under
-- the old policy a viewer who can see only the OTHER partner's date could
-- create a claim against that row -- claim_wishlist_item gates on the celebrant
-- the caller named, not on the row's storage id -- and then be unable to read
-- it back. The claim would exist and be invisible to them.
--
-- The new branch is guarded on `partner_id is not null`, so an unshared
-- occasion cannot reach it at all: this cannot admit anything the old policy
-- refused.
drop policy "Celebrated occasions follow the underlying date's privacy"
  on public.occasions;

create policy "Celebrated occasions follow the underlying date's privacy"
  on public.occasions for select to authenticated
  using (
    celebrant_id is not null
    and (
      exists (
        select 1 from public.profile_info pi
        where pi.user_id = occasions.celebrant_id
          and pi.category = 'dates'
          and pi.field_name = occasions.kind::text
          and public.can_view_field(
            pi.user_id, (select public.requesting_user_id()), pi.privacy_settings)
      )
      or (
        partner_id is not null
        and exists (
          select 1 from public.profile_info pi
          where pi.user_id = occasions.partner_id
            and pi.category = 'dates'
            and pi.field_name = occasions.kind::text
            and public.can_view_field(
              pi.user_id, (select public.requesting_user_id()), pi.privacy_settings)
        )
      )
    )
  );
```

- [ ] **Step 2: Apply.** `npx supabase db push`

- [ ] **Step 3: Write the RLS test**

`supabase/tests/rls/20_shared_anniversary_reads.sql`, token `OK_20_shared_anniversary_reads`. This file grows again in Tasks 4 and 5; start it with the policy assertions:

1. a viewer who can see the **celebrant's** date reads the shared row;
2. a viewer who can see **only the partner's** date reads the shared row — the whole point of the widening;
3. a viewer who can see **neither** date reads zero;
4. on an **unshared** occasion (`partner_id is null`) a viewer who can see neither reads zero — proves the new branch cannot admit anything the old policy refused.

Fixtures: two users whose anniversary `privacy_settings` differ, in different groups, so "can see one but not the other" is a real state rather than a coincidence of layout.

- [ ] **Step 4: Declare it** in `MANIFEST` (append `20_shared_anniversary_reads.sql`).

- [ ] **Step 5: Prove it bites.** Inside `begin; … rollback;`, drop the `or (partner_id is not null …)` branch from a scratch copy of the policy, confirm assertion 2 fails while 1, 3 and 4 still pass, then roll back. Assertion 4 passing under both versions is the evidence the branch is additive.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260912000001_occasion_partner.sql \
        supabase/tests/rls/20_shared_anniversary_reads.sql supabase/tests/rls/MANIFEST
git commit -m "feat(anniversaries): let a celebrated occasion carry a partner"
```

---

### Task 3: the four link RPCs

**Files:**
- Create: `supabase/migrations/20260912000002_anniversary_link_rpcs.sql`
- Create: `supabase/tests/rls/19_anniversary_link_rpcs.sql`
- Modify: `supabase/tests/rls/MANIFEST`

**Interfaces:**
- Consumes: `public.anniversary_links` (Task 1), `occasions.partner_id` (Task 2), `public.get_shared_groups(text, text)`, `public.celebration_date_in_year(text, integer)`, `public.requesting_user_id()`.
- Produces, all `SECURITY DEFINER`, all granted to `authenticated`:
  - `request_anniversary_link(p_partner_id text, p_date text) returns uuid`
  - `confirm_anniversary_link(p_link_id uuid) returns void`
  - `decline_anniversary_link(p_link_id uuid) returns boolean`
  - `unlink_anniversary(p_link_id uuid) returns boolean`

- [ ] **Step 1: Write the migration**

```sql
-- =============================================================================
-- rybn: requesting, confirming, declining and undoing an anniversary link
-- =============================================================================
--
-- All four are SECURITY DEFINER and granted to `authenticated`, so all four are
-- reachable directly through PostgREST with nothing upstream having run. Every
-- rule the UI appears to enforce is therefore enforced here as well.

create or replace function public.request_anniversary_link(
  p_partner_id text,
  p_date text
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_a      text;
  v_b      text;
  v_id     uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if p_partner_id = v_caller then
    raise exception 'you cannot share an anniversary with yourself'
      using errcode = '22023';
  end if;

  -- Enforced here, not only in the picker: this function is reachable directly.
  -- Same message for "no such user" and "not in a group with you", so it is not
  -- a probe for which user ids exist.
  if not exists (select 1 from public.get_shared_groups(v_caller, p_partner_id)) then
    raise exception 'that person is not in any of your groups'
      using errcode = '22023';
  end if;

  if public.celebration_date_in_year(
       p_date, extract(year from current_date)::integer) is null then
    raise exception 'that is not a usable date' using errcode = '22023';
  end if;

  v_a := least(v_caller, p_partner_id);
  v_b := greatest(v_caller, p_partner_id);

  insert into public.anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
  values (v_a, v_b, 'pending', v_caller, p_date)
  on conflict (user_a, user_b) do update
    set agreed_date  = excluded.agreed_date,
        initiated_by = excluded.initiated_by,
        status       = 'pending',
        created_at   = now()
    -- Re-requesting refreshes a PENDING invitation. It must not quietly
    -- un-confirm a link that already exists: without this predicate, either
    -- partner could reset a confirmed pairing by asking again.
    where anniversary_links.status = 'pending'
  returning id into v_id;

  if v_id is null then
    raise exception 'you already share an anniversary with that person'
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

create or replace function public.confirm_anniversary_link(p_link_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_link   record;
  v_other  text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_link from public.anniversary_links
   where id = p_link_id and status = 'pending';

  -- Only the RECIPIENT may confirm. One message for "no such request", "already
  -- confirmed" and "not yours", so this is not an oracle for other people's
  -- pending requests.
  if v_link is null
     or v_caller not in (v_link.user_a, v_link.user_b)
     or v_caller = v_link.initiated_by
  then
    raise exception 'no anniversary request for you to confirm'
      using errcode = '22023';
  end if;

  update public.anniversary_links
     set status = 'confirmed', confirmed_at = now()
   where id = p_link_id;

  -- Accepting adopts the agreed date. The UI states this outright; it is the
  -- whole reason the two partners end up with one date instead of two that
  -- drift.
  insert into public.profile_info (user_id, category, field_name, field_value)
  values (v_caller, 'dates', 'anniversary', v_link.agreed_date)
  on conflict on constraint profile_info_user_id_category_field_name_key
  do update set field_value = excluded.field_value;

  -- ---- reconcile anything already materialized -------------------------
  -- Ensure a canonical row exists for every year the non-canonical partner has
  -- one, then move that year's tags and claims onto it and drop the duplicate.
  -- Without this a couple who both already had a materialized anniversary keeps
  -- TWO occasion ids for one event -- the exact defect this feature removes.
  insert into public.occasions (kind, celebrant_id, occasion_date, created_by)
  select 'anniversary', v_link.user_a, o.occasion_date, v_caller
    from public.occasions o
   where o.kind = 'anniversary' and o.celebrant_id = v_link.user_b
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do nothing;

  -- An item may already be tagged for BOTH partners' occasions, so the move can
  -- collide; the survivors are deleted immediately below.
  insert into public.wishlist_item_occasions (item_id, occasion_id)
  select t.item_id, canon.id
    from public.wishlist_item_occasions t
    join public.occasions dup on dup.id = t.occasion_id
    join public.occasions canon
      on canon.kind = 'anniversary'
     and canon.celebrant_id = v_link.user_a
     and canon.occasion_year = dup.occasion_year
   where dup.kind = 'anniversary' and dup.celebrant_id = v_link.user_b
  on conflict (item_id, occasion_id) do nothing;

  delete from public.wishlist_item_occasions t
   using public.occasions dup
   where dup.id = t.occasion_id
     and dup.kind = 'anniversary' and dup.celebrant_id = v_link.user_b;

  -- No collision is possible here: wishlist_claims_one_active keys on
  -- (item_id) where released_at is null and does not include the occasion.
  update public.wishlist_claims c
     set occasion_id = canon.id
    from public.occasions dup
    join public.occasions canon
      on canon.kind = 'anniversary'
     and canon.celebrant_id = v_link.user_a
     and canon.occasion_year = dup.occasion_year
   where c.occasion_id = dup.id
     and dup.kind = 'anniversary' and dup.celebrant_id = v_link.user_b;

  delete from public.occasions
   where kind = 'anniversary' and celebrant_id = v_link.user_b;

  update public.occasions
     set partner_id = v_link.user_b
   where kind = 'anniversary' and celebrant_id = v_link.user_a;
end;
$$;

create or replace function public.decline_anniversary_link(p_link_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_deleted int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- Only the recipient may decline, and only a pending row. Returns false
  -- rather than raising when there is nothing to decline: declining something
  -- already gone is not an error, and a DELETE filtered to zero rows is
  -- expressible in the RLS harness where a raise is not.
  delete from public.anniversary_links
   where id = p_link_id
     and status = 'pending'
     and initiated_by <> v_caller
     and v_caller in (user_a, user_b);

  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

create or replace function public.unlink_anniversary(p_link_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_link    record;
  v_deleted int;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_link from public.anniversary_links where id = p_link_id;

  if v_link is null or v_caller not in (v_link.user_a, v_link.user_b) then
    return false;
  end if;

  delete from public.anniversary_links where id = p_link_id;
  get diagnostics v_deleted = row_count;

  -- The occasion row survives with its tags and claims intact and simply stops
  -- being shared. Splitting those between the two people would be guesswork
  -- about which gift was for whom.
  update public.occasions
     set partner_id = null
   where kind = 'anniversary' and celebrant_id = v_link.user_a;

  return v_deleted > 0;
end;
$$;

grant execute on function public.request_anniversary_link(text, text) to authenticated, service_role;
grant execute on function public.confirm_anniversary_link(uuid) to authenticated, service_role;
grant execute on function public.decline_anniversary_link(uuid) to authenticated, service_role;
grant execute on function public.unlink_anniversary(uuid) to authenticated, service_role;
```

- [ ] **Step 2: Apply.** `npx supabase db push`

- [ ] **Step 3: Write the RLS test**

`supabase/tests/rls/19_anniversary_link_rpcs.sql`, token `OK_19_anniversary_link_rpcs`.

**Live (non-raising) assertions:**

1. `decline_anniversary_link` by the recipient returns **true** and removes the row;
2. `decline_anniversary_link` by the **initiator** returns **false** and the row survives — only the recipient may decline;
3. `unlink_anniversary` by a non-participant returns **false** and the row survives;
4. `unlink_anniversary` by either partner returns **true**, clears `partner_id`, and leaves the occasion row and its tags in place;
5. `confirm_anniversary_link` by the recipient sets `status = 'confirmed'` and writes `agreed_date` into the recipient's `profile_info` anniversary row;
6. confirm with the recipient having **no** prior anniversary creates the row;
7. **reconciliation**: with both partners already holding a materialized anniversary occasion for the same year, and a gift tagged for each, confirming leaves exactly ONE occasion, both tags present on it, and every claim re-pointed.

**Anchored source assertions** (these paths RAISE, and an uncaught raise aborts the file's batch):

8. `request_anniversary_link` contains its shared-group guard, its self-link guard and its date-validity guard, each matched line-anchored with its own `(?n)`;
9. `confirm_anniversary_link` contains the recipient guard — specifically `v_caller = v_link.initiated_by` — so the initiator cannot confirm their own request;
10. a `position('/*' in pg_get_functiondef(…)) = 0` floor over each of the four functions, because line-anchoring does not defend against a block comment.

Scope every `pg_proc` lookup by exact `::regprocedure`.

Assertion 7 is the one that justifies the task: an implementation that confirms the link but skips reconciliation passes 1–6 and 8–10 untouched.

- [ ] **Step 4: Declare it** in `MANIFEST` (append `19_anniversary_link_rpcs.sql`).

- [ ] **Step 5: Prove it bites.** Inside `begin; … rollback;`, delete the reconciliation block from a scratch copy of `confirm_anniversary_link`, confirm assertion 7 fails, roll back, then verify `pg_proc` holds no scratch copy and `occasions` is unchanged.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260912000002_anniversary_link_rpcs.sql \
        supabase/tests/rls/19_anniversary_link_rpcs.sql supabase/tests/rls/MANIFEST
git commit -m "feat(anniversaries): request, confirm, decline and unlink RPCs"
```

---

### Task 4: canonicalisation in `get_or_create_celebrated_occasion`

**Files:**
- Create: `supabase/migrations/20260912000003_canonical_anniversary.sql`
- Modify: `supabase/tests/rls/20_shared_anniversary_reads.sql`

**Interfaces:**
- Consumes: `public.anniversary_links` (Task 1), `occasions.partner_id` (Task 2).
- Produces: `get_or_create_celebrated_occasion(text, public.occasion_kind)` unchanged in signature, now resolving either partner to one row.

- [ ] **Step 1: Replace the function**

Copy `supabase/migrations/20260911100000_celebrated_occasion_for_claims.sql` verbatim and insert the resolution immediately **after** the existing `can_view_field` gate and **before** the `celebration_date_in_year` call, adding two declarations (`v_target text; v_partner text;`):

```sql
  -- Resolve a linked couple to ONE row. The privacy gate above has already run
  -- against the celebrant the CALLER named -- a caller entitled to act on Sam's
  -- anniversary stays entitled to, and which of the two ids the row is stored
  -- under is an internal detail that must not become a reason to refuse them.
  v_target  := p_celebrant_id;
  v_partner := null;

  if p_kind = 'anniversary' then
    select case when l.user_a = p_celebrant_id then l.user_b else l.user_a end,
           l.user_a
      into v_partner, v_target
      from public.anniversary_links l
     where l.status = 'confirmed'
       and p_celebrant_id in (l.user_a, l.user_b);

    if v_target is null then
      v_target  := p_celebrant_id;
      v_partner := null;
    end if;
  end if;
```

Then change the insert to use them:

```sql
  insert into public.occasions (kind, celebrant_id, partner_id, occasion_date, created_by)
  values (p_kind, v_target, v_partner, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do update set occasion_date = excluded.occasion_date,
                partner_id    = excluded.partner_id
  returning id into v_id;
```

Note the date still comes from the celebrant the caller named. After Task 3 both partners hold the same date, so this is the same value either way — and if they ever diverge, the caller gets the date they could actually see.

- [ ] **Step 2: Apply.** `npx supabase db push`

- [ ] **Step 3: Extend the RLS test** in `20_shared_anniversary_reads.sql`:

5. `get_or_create_celebrated_occasion(user_a, 'anniversary')` and `get_or_create_celebrated_occasion(user_b, 'anniversary')` return the **same** uuid. This is the assertion the entire design rests on;
6. the resulting row has `celebrant_id = user_a` and `partner_id = user_b`, asserted separately so a swap is visible;
7. for an **unlinked** user the function still returns a row with `partner_id is null` — proving the anniversary branch did not change unshared behaviour;
8. for `kind = 'birthday'` on a user who **is** in a confirmed anniversary link, the row is keyed to that user with `partner_id is null` — proving the resolution is scoped to anniversaries and does not leak into birthdays.

Raise the file's floor to match its real increment count.

- [ ] **Step 4: Run** `npm run test:rls` — all files pass.

- [ ] **Step 5: Prove it bites.** In a rolled-back transaction, build a scratch copy with the `if p_kind = 'anniversary'` resolution removed, show assertion 5 returns two different uuids against it and one uuid against the shipped function, then roll back and confirm no scratch copy survives.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260912000003_canonical_anniversary.sql \
        supabase/tests/rls/20_shared_anniversary_reads.sql
git commit -m "feat(anniversaries): resolve a linked couple to one occasion"
```

---

### Task 5: `get_upcoming_occasions` returns the partner

**Files:**
- Create: `supabase/migrations/20260912000004_derivation_partner.sql`
- Modify: `supabase/tests/rls/20_shared_anniversary_reads.sql`
- Modify: `types/database.ts`

**Interfaces:**
- Consumes: `public.anniversary_links`, `public.can_view_field`.
- Produces: `get_upcoming_occasions(integer)` returning three additional columns — `partner_id text`, `partner_username text`, `partner_display_name text` — appended after `celebrant_display_name`.

- [ ] **Step 1: Write the migration**

Postgres will not change a function's return type in place, so this is a drop and recreate in one migration:

```sql
drop function if exists public.get_upcoming_occasions(integer);
```

Recreate it from `20260910100002_occasions_derivation.sql` with the three columns added to `returns table(...)` after `celebrant_display_name`, the group-date branch selecting `null::text, null::text, null::text` for them, and the celebrated branch replaced by two mutually exclusive arms:

```sql
  -- Arm 1: a confirmed couple BOTH of whose dates this viewer can see. One row,
  -- keyed to the canonical partner, carrying both names.
  select
    o.id, 'anniversary'::public.occasion_kind, null::text, d.celebration,
    l.user_a, ua.username, ua.display_name,
    l.user_b, ub.username, ub.display_name,
    null::uuid, null::text
  from anniversary_links l
  join user_profiles ua on ua.id = l.user_a
  join user_profiles ub on ub.id = l.user_b
  join profile_info pa
    on pa.user_id = l.user_a and pa.category = 'dates' and pa.field_name = 'anniversary'
  join profile_info pb
    on pb.user_id = l.user_b and pb.category = 'dates' and pb.field_name = 'anniversary'
  cross join lateral (
    select case
      when public.celebration_date_in_year(pa.field_value, v_year) >= current_date
        then public.celebration_date_in_year(pa.field_value, v_year)
      else public.celebration_date_in_year(pa.field_value, v_year + 1)
    end as celebration
  ) d
  left join occasions o
    on o.celebrant_id = l.user_a and o.kind = 'anniversary'
   and o.occasion_year = extract(year from d.celebration)::integer
  where l.status = 'confirmed'
    and d.celebration is not null
    and d.celebration between current_date and v_until
    and public.can_view_field(l.user_a, v_viewer, pa.privacy_settings)
    and public.can_view_field(l.user_b, v_viewer, pb.privacy_settings)
```

The existing per-person branch stays, with `null::text, null::text, null::text` for the partner columns and one added exclusion so a person is never emitted twice:

```sql
    -- ...existing where clauses, plus:
    and not (
      pi.field_name = 'anniversary'
      and exists (
        select 1 from anniversary_links l2
        join profile_info p2
          on p2.category = 'dates' and p2.field_name = 'anniversary'
         and p2.user_id = case when l2.user_a = pi.user_id then l2.user_b else l2.user_a end
        where l2.status = 'confirmed'
          and pi.user_id in (l2.user_a, l2.user_b)
          and public.can_view_field(p2.user_id, v_viewer, p2.privacy_settings)
      )
    )
```

That exclusion is what makes the collapse **per viewer**: a person is suppressed from the individual branch only when this viewer can also see their partner's date, which is exactly when arm 1 emits the merged row instead.

Re-grant after the recreate:

```sql
grant execute on function public.get_upcoming_occasions(integer) to authenticated, service_role;
```

- [ ] **Step 2: Apply.** `npx supabase db push`

- [ ] **Step 3: Hand-edit `types/database.ts`.** This task owns **every** change to that file in this plan, assigned to one task deliberately: phase 1 lost a review round to a `Functions` entry no task owned. Add all of:
  - the three new columns on `get_upcoming_occasions`' `Returns`;
  - `partner_id: string | null` on the `occasions` row type (Task 2 added the column);
  - the `anniversary_links` table type — `id`, `user_a`, `user_b`, `status`, `initiated_by`, `agreed_date`, `created_at` as `string`, `confirmed_at` as `string | null`;
  - four `Functions` entries: `request_anniversary_link(p_partner_id: string, p_date: string) => string`, `confirm_anniversary_link(p_link_id: string) => undefined`, `decline_anniversary_link(p_link_id: string) => boolean`, `unlink_anniversary(p_link_id: string) => boolean`.

  Task 8 consumes all of these; without them its server actions will not typecheck. **Never regenerate** — four `StoredImageValue` annotations are load-bearing and `lib/storage/image-value.ts` fails to compile without them.

- [ ] **Step 4: Extend the RLS test** in `20_shared_anniversary_reads.sql`:

9. a viewer who can see **both** dates gets exactly ONE anniversary row for the couple, with both partner columns populated;
10. a viewer who can see **only one** partner's date gets exactly ONE row for that person, with partner columns **null** — not the merged row, and not zero rows;
11. a viewer who can see **neither** gets zero;
12. an unlinked user with an anniversary is unaffected — one row, partner columns null.

Assertion 10 is what proves the collapse is per viewer rather than global; an implementation that merges whenever a link exists passes 9, 11 and 12 and fails only this one.

Pin the fixture dates to fixed calendar anchors, not offsets from `current_date`.

- [ ] **Step 5: Run** `npm run test:rls` and `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260912000004_derivation_partner.sql \
        supabase/tests/rls/20_shared_anniversary_reads.sql types/database.ts
git commit -m "feat(anniversaries): collapse a couple's anniversary per viewer"
```

---

### Task 6: the label

**Files:**
- Modify: `lib/occasions/display.ts`
- Create: `lib/occasions/display.test.ts` (if absent; otherwise extend)

**Interfaces:**
- Consumes: `get_upcoming_occasions`' three new columns (Task 5).
- Produces: `UpcomingOccasion` gains `partnerId: string | null`, `partnerUsername: string | null`, `partnerDisplayName: string | null`; `occasionLabel` renders both names.

- [ ] **Step 1: Write the failing tests**

```ts
const base = {
  occasionId: "o1", kind: "anniversary" as const, name: null,
  occasionDate: "2026-06-12", celebrantId: "u1",
  celebrantUsername: "alex", celebrantDisplayName: "Alex",
  groupId: null, groupName: null,
  partnerId: null, partnerUsername: null, partnerDisplayName: null,
};

it("names both partners when the viewer can see both", () => {
  // Fails if the partner fields are ignored -- the single-name label is what
  // shipped before, so it is the wrong answer that looks right.
  expect(occasionLabel({ ...base, partnerId: "u2",
    partnerUsername: "sam", partnerDisplayName: "Sam" }))
    .toBe("Alex & Sam's Anniversary");
});

it("falls back to the single name when there is no partner", () => {
  expect(occasionLabel(base)).toBe("Alex's Anniversary");
});

it("applies the possessive to the SECOND name only", () => {
  // "Alex & Chris' Anniversary", not "Alex' & Chris' " or "Alex & Chris's".
  // The existing rule is case-insensitive because display names are free text.
  expect(occasionLabel({ ...base, partnerId: "u2",
    partnerUsername: "chris", partnerDisplayName: "CHRIS" }))
    .toBe("Alex & CHRIS' Anniversary");
});
```

- [ ] **Step 2: Run, confirm they fail** — `npx vitest run lib/occasions/display.test.ts`.

- [ ] **Step 3: Implement.** Add the three optional fields to `UpcomingOccasion`, and in `occasionLabel` resolve the partner name the same way the celebrant's is resolved, then join with `" & "` before applying the existing possessive rule to the combined string's final name.

- [ ] **Step 4: Run** `npx vitest run` — all pass.

- [ ] **Step 5: Commit**

```bash
git add lib/occasions/display.ts lib/occasions/display.test.ts
git commit -m "feat(anniversaries): label a shared anniversary with both names"
```

---

### Task 7: one reminder per couple

**Files:**
- Modify: `lib/actions/date-reminders.ts`
- Create: `lib/actions/date-reminders.test.ts`

**Interfaces:**
- Consumes: `public.anniversary_links`.
- Produces: no signature change.

- [ ] **Step 1: Write the failing test**

Mock the Supabase client as `lib/actions/occasions.test.ts` does. Assert that when the reminder source yields an anniversary for both halves of a confirmed couple, exactly ONE `date_notifications` row is inserted, keyed to the canonical partner — and that two unrelated people with the same date still produce two.

The second case is what stops the fix from collapsing everything that shares a calendar day.

- [ ] **Step 2: Run, confirm it fails.**

- [ ] **Step 3: Implement.** Before inserting, drop any anniversary reminder whose celebrant is the **non-canonical** half of a confirmed link; the canonical half's reminder stands for the pair.

- [ ] **Step 3b: Use the shared label in the email.** The surviving reminder is keyed to whichever id sorts smaller, which is arbitrary and would otherwise read as "Alex's anniversary" to someone who thinks of the couple as Sam's. Resolve the partner and render both names, matching `occasionLabel`'s output. Add a test asserting the rendered copy names **both** partners for a linked couple and one name for an unlinked person — without it, the dedupe in step 3 silently makes the email wrong for half of every couple.

- [ ] **Step 4: Run** `npx vitest run`.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/date-reminders.ts lib/actions/date-reminders.test.ts
git commit -m "feat(anniversaries): send one reminder per couple"
```

---

### Task 8: server actions

**Files:**
- Create: `lib/actions/anniversary-links.ts`
- Create: `lib/actions/anniversary-links.test.ts`

**Interfaces:**
- Consumes: the four RPCs (Task 3).
- Produces:
  - `requestAnniversaryLink(partnerId: string, date: string): Promise<{ data: { linkId: string } } | { error: string }>`
  - `confirmAnniversaryLink(linkId: string): Promise<{ ok: true } | { error: string }>`
  - `declineAnniversaryLink(linkId: string): Promise<{ ok: boolean } | { error: string }>`
  - `unlinkAnniversary(linkId: string): Promise<{ ok: boolean } | { error: string }>`
  - `getMyAnniversaryLink(): Promise<{ data: AnniversaryLink | null } | { error: string }>`

  where `AnniversaryLink` is declared in this module and exported as a **type**
  (a `"use server"` module may export only async *values*; a type export is
  erased at compile time and is fine):

```ts
export type AnniversaryLink = {
  id: string;
  partnerId: string;
  partnerUsername: string | null;
  partnerDisplayName: string | null;
  status: "pending" | "confirmed";
  agreedDate: string;
  /** True when the CURRENT user sent the request -- the UI shows "cancel"
   *  rather than "confirm/decline" in that case. */
  initiatedByMe: boolean;
};
```

  `getMyAnniversaryLink` reads `anniversary_links` through the user-scoped
  client and relies on Task 1's SELECT policy to return only the caller's own
  row; it resolves `partnerId` to whichever of `user_a`/`user_b` is not the
  caller, so no consumer has to know about canonical ordering.

- [ ] **Step 1: Write the failing tests.** Cover: each action uses the **user-scoped** client (the RPCs pin to `requesting_user_id()`; the admin client carries no Clerk subject and every one of them refuses); a `22023` from any RPC returns the RPC's own user-facing message verbatim rather than a generic string; signed out returns `{ error: "Not authenticated" }` **without** a database call; `declineAnniversaryLink` returning false yields `{ ok: false }` rather than an error.

- [ ] **Step 2: Run, confirm they fail.**

- [ ] **Step 3: Implement** a `"use server"` module exporting exactly those five async functions. A `"use server"` module may export **only** async functions — a shared constant must be module-private; this bit an earlier phase.

- [ ] **Step 4: Run** `npx vitest run`, `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/anniversary-links.ts lib/actions/anniversary-links.test.ts
git commit -m "feat(anniversaries): server actions for linking"
```

---

### Task 9: the UI

**Files:**
- Create: `components/profile/AnniversaryPartner.tsx`
- Modify: `app/(dashboard)/profile/edit/page.tsx`
- Modify: `components/notifications/NotificationsList.tsx`
- Modify: `lib/notifications/unread.ts`

**Interfaces:**
- Consumes: all five actions from Task 8; `occasionLabel` (Task 6).

- [ ] **Step 1: Build `AnniversaryPartner`.** A client component rendered beneath `DatesSection` on the profile edit page. `DatesSection` stays a pure react-hook-form section — the link is an action, not a form field, so it does not belong inside the form. Three states: **unlinked** (a picker of people you share a group with, plus "Ask to share"), **pending** (who was asked, with cancel), **confirmed** (partner's name, with "Unlink").

- [ ] **Step 2: Render a pending request in `NotificationsList`.** Alongside date reminders, show incoming requests with Confirm and Decline. The copy must state the consequence outright, e.g. *"Alex says your shared anniversary is 12 June. Confirming will set your anniversary to that date."* — decision 4 of the spec turns on the user having been told.

- [ ] **Step 3: Count pending requests as unread** in `lib/notifications/unread.ts`, so the bell's badge reflects them. Keep the one shared filter: the badge and the page must not disagree about what unread means.

- [ ] **Step 4: Verify.** `npx vitest run`, `npx tsc --noEmit` (zero errors), `npx next build` green, eslint no worse than 61.

- [ ] **Step 5: Mobile check.** These are new cards with a name, a button pair and a state badge — the exact shape that overflowed in `76c1214`. Stack below `sm:`, `min-w-0` on the name block, `shrink-0` on the avatar.

- [ ] **Step 6: Manual check, and say plainly whether it was done.** Two accounts: A requests, B confirms, both see one occasion labelled with both names; a third person who can see only A's date still sees "A's Anniversary". If you cannot run it, say so explicitly rather than implying it passed.

- [ ] **Step 7: Commit**

```bash
git add components/profile/AnniversaryPartner.tsx components/notifications/NotificationsList.tsx \
        lib/notifications/unread.ts "app/(dashboard)/profile/edit/page.tsx"
git commit -m "feat(anniversaries): link a partner and confirm from notifications"
```

---

## Done when

- Two people in a group link their anniversaries and see ONE occasion labelled with both names.
- A third person who can see only one partner's date still sees that person's anniversary, unchanged.
- Tagging a gift from either partner's list, and claiming from either, land on the same occasion id.
- A couple receives one reminder email, not two.
- Confirming a link where both already had materialized occasions leaves one, with every tag and claim preserved.
- `npm run test:rls` passes with `18`, `19` and `20` declared and proven to bite.

## Out of scope

- More than two people sharing an occasion.
- Per-group links — a couple is a couple in every group they share.
- Any history of past pairings; unlinking leaves no record.
- Shared **birthdays** (twins).
- Notifying the initiator that a request was declined.
- Reconstructing a separate occasion row for the non-canonical partner on unlink — see the spec's unlink section for why splitting the tags would be guesswork.
