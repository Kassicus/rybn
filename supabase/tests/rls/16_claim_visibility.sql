-- Claims are read-gated by the ITEM's visibility, same shape as
-- wishlist_item_occasions (see 14_tag_visibility.sql's header) -- with one
-- addition that is the entire point of this table: the item's OWNER is
-- carved out of the SELECT policy, so no query the owner can write returns
-- their own items' claims. That is the product's core privacy promise
-- (Task 2 brief's header, "OWNER-BLINDNESS IS ENFORCED HERE, not in
-- application code"), and it is enforced by
-- 20260911100001_wishlist_claims.sql's policy, not by this test -- this test
-- only proves the enforcement is real.
--
-- CORRECTION TO THE ORIGINAL BRIEF, recorded here because it changes the
-- shape of this file relative to what a first reading of the brief suggests.
-- The brief's assertion 4 said: "a direct insert by an authenticated caller
-- creates no row (no INSERT policy). Assert by row count." That is wrong and
-- was never attempted. A denied INSERT's WITH CHECK -- or, with no INSERT
-- policy at all, RLS's default-deny for an enabled table -- raises an
-- unconditional, uncatchable 42501 ("new row violates row-level security
-- policy" / "permission denied"), not a silently-filtered zero rows the way a
-- SELECT's USING clause would give you. test-rls.sh sends this whole file as
-- ONE batch and bans `exception when` file-wide, so that raise would abort
-- EVERY assertion in this file, including the owner-blindness headline
-- (assertion 2). This is already documented at
-- 14_tag_visibility.sql:40-46 and reconfirmed directly against this project
-- in phase 2. So assertion 4 is replaced with two checks that are strictly
-- STRONGER than a row-count attempt, and both are live catalog reads that
-- never raise:
--
--   4. has_table_privilege('authenticated', 'public.wishlist_claims', <verb>)
--      is false for INSERT, UPDATE and DELETE. The harness impersonates with
--      set_config('role', 'authenticated', true), so `authenticated` is the
--      role whose privileges actually matter on the query path.
--   5. Zero policies on public.wishlist_claims with cmd in
--      (INSERT, UPDATE, DELETE, ALL), and exactly one SELECT policy.
--
-- Why 4 is not vacuous the way it might look: the migration's own `grant
-- select on public.wishlist_claims to authenticated` line does NOT, by
-- itself, mean authenticated lacks the other three privileges. Confirmed
-- directly against this project while building this migration: Supabase's
-- per-role default privileges (set at project provisioning, and undone for
-- `anon` but not for `authenticated` by clerk_native_baseline.sql:1997-1999)
-- grant every DML verb to `authenticated` on any newly created table
-- regardless of what that table's own migration explicitly grants --
-- wishlist_item_occasions's migration (20260911000002) grants authenticated
-- only select/insert/delete, and yet `authenticated` held UPDATE on it too,
-- live, before this test was written. Left alone, wishlist_claims would have
-- had the identical gap: `grant select` on the label, INSERT/UPDATE/DELETE
-- live underneath it. 20260911100001_wishlist_claims.sql therefore carries an
-- explicit `revoke insert, update, delete on public.wishlist_claims from
-- authenticated` after its grant line, specifically so assertion 4 below is
-- checking something true rather than something the default-privilege
-- mechanism already contradicted. Without that revoke, this assertion would
-- fail on the CORRECT, freshly-applied migration, not merely on a future
-- regression -- worth stating plainly since it is the one place in this task
-- where the brief's stated assumption ("your grant line gives it select
-- only") did not hold against the live project and had to be verified and
-- fixed rather than trusted.
--
-- Why 5 is strictly stronger than a row-count attempt would have been, and
-- the one that actually matters most: it is what would have caught phase 2's
-- live incident, where a stalled agent left a permissive INSERT policy on
-- wishlist_item_occasions granted to authenticated. Postgres ORs permissive
-- policies for the same command together, so a SECOND policy sitting
-- alongside a correct one is invisible to any check that filters by
-- expression text -- only a bare count catches it. A row-count attempt, even
-- if it had been safe to run, would have proven only "this one insert did not
-- land" -- nothing about whether the privilege or the policy surface that
-- would admit a DIFFERENT insert had quietly grown.
--
-- Assertion 2 (the owner sees zero) is the one that must not pass vacuously:
-- assertion 1 proves the row is readable by SOMEBODY, so 2 is measuring the
-- owner exclusion specifically, not an empty table nobody can read. Assertion
-- 1 also proves the claim is visible to a co-member who did NOT make it, not
-- merely to the claimer viewing their own row -- the real product behaviour
-- (every giver in the group sees who has claimed what) and, incidentally, the
-- shape that would catch an inverted can_view_wishlist_item() argument order.
--
-- Be exact about WHY, because the intuitive reading of this is wrong. The
-- policy calls can_view_wishlist_item(wi.user_id, requesting_user_id(), ...)
-- -- that is (owner, viewer). Swapping the first two arguments makes
-- `viewer_id` the ITEM OWNER, and the function self-pins `viewer_id` against
-- requesting_user_id() (clerk_native_baseline.sql:774-776), returning false
-- outright when they differ. In assertion 1 the caller is the co-member and
-- the owner is somebody else, so the swapped call returns false immediately
-- and assertion 1 flips to zero.
--
-- The self-pin is the ONLY thing catching the inversion. Everything past it is
-- symmetric in the two ids: the self-view early return compares them for
-- equality (:779-781), and get_shared_groups() joins group_members to itself
-- (:667-670), which yields the same groups whichever way round they go. So if
-- the self-pin is ever relaxed -- admitting a service context, say -- this
-- file silently STOPS covering argument inversion, and no assertion here will
-- announce that.
--
-- Assertion 3 (a stranger sees zero) is proven on the SAME item as
-- assertions 1-2, sharing the same defence-in-depth caveat
-- 14_tag_visibility.sql's header states for its own read policy: the EXISTS
-- subquery below runs AS the querying role, so it is itself filtered by
-- wishlist_items' own RLS (two SELECT policies that already union to "own
-- item OR can_view_wishlist_item(...)"). This file cannot distinguish which
-- of the two layers is holding the line for the stranger case; the explicit
-- can_view_wishlist_item() call in this table's own policy is deliberate
-- belt-and-suspenders, proven only in combination with the other layer here.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes (including the claim
-- row itself -- there is no INSERT policy, and after the revoke above
-- `authenticated` holds no INSERT privilege either) happen while
-- impersonating the connecting (RLS-bypassing) role; only the read
-- assertions run as `authenticated`, so `role` is toggled back to the
-- captured `current_user` around fixture mutations and, finally, before the
-- catalog checks and the token insert.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role      text;
  v_checks         int := 0;
  v_owner          text := 'user_claim_owner';
  v_stranger       text := 'user_claim_stranger';
  v_comember       text := 'user_claim_comember';
  v_claimer        text := 'user_claim_claimer';
  v_group          uuid;
  v_item           uuid;
  v_occasion       uuid;
  v_visible        int;
  v_priv_insert    boolean;
  v_priv_update    boolean;
  v_priv_delete    boolean;
  v_write_policies int;
  v_select_policies int;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values (v_owner,    'claimowner',    'Claim Owner'),
           (v_stranger, 'claimstranger', 'Claim Stranger'),
           (v_comember, 'claimcomember', 'Claim Comember'),
           (v_claimer,  'claimclaimer',  'Claim Claimer');

  insert into groups (name, type, invite_code, created_by)
    values ('Claim Family', 'family', 'CLAIMFA1', v_owner)
    returning id into v_group;

  -- add_group_creator_as_owner() already added v_owner. v_comember and
  -- v_claimer join too, sharing the "family" group type with the owner;
  -- v_stranger stays out, so assertion 3 proves exclusion from a group the
  -- stranger never belonged to, not a coincidence of fixture layout.
  insert into group_members (group_id, user_id, role)
    values (v_group, v_comember, 'member'),
           (v_group, v_claimer, 'member')
    on conflict do nothing;

  -- Visible to the "family" group type, which v_comember and v_claimer share
  -- with the owner and v_stranger does not.
  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'Claimable Item',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item;

  -- Any occasion serves every assertion below: the SELECT policy on
  -- wishlist_claims gates on the ITEM, never the occasion (same shape as
  -- wishlist_item_occasions's own SELECT policy).
  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_owner, 'birthday', '1990-06-15')
    returning id into v_occasion;

  -- The claim itself, written by v_claimer -- but as the connecting
  -- (RLS-bypassing) role: there is no INSERT policy on this table, and after
  -- 20260911100001_wishlist_claims.sql's revoke, `authenticated` holds no
  -- INSERT privilege on it either, so this could not be written any other
  -- way from inside this harness. Still `current_user` (the connecting
  -- role), not yet impersonating anyone.
  insert into wishlist_claims (item_id, occasion_id, claimed_by)
    values (v_item, v_occasion, v_claimer);

  ---------------------------------------------------------------------------
  -- Assertion 1: a co-member who can see the item -- and did NOT make this
  -- claim themselves -- sees it. Proves the row is readable by somebody
  -- (making assertion 2 non-vacuous) and proves visibility follows the
  -- ITEM rather than "you only see your own claims". See the file header for
  -- why this is also the assertion an inverted can_view_wishlist_item()
  -- argument order would flip.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_comember || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from wishlist_claims where item_id = v_item;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: co-member % sees % claim(s) on an item visible to their group, expected 1',
      v_comember, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: the item's OWNER must see ZERO claims on their own item --
  -- the headline invariant. Assertion 1 already proved the row is visible to
  -- somebody, so this is measuring the owner exclusion specifically.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);

  select count(*) into v_visible
    from wishlist_claims where item_id = v_item;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: owner % sees % claim(s) on their own item, expected 0 -- owner-blindness is broken',
      v_owner, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: a stranger, sharing no group with the owner, must not see
  -- the claim either -- the item is invisible to them at all, so nothing
  -- about it, including who claimed it, should leak.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_stranger || '","role":"authenticated"}', true);

  select count(*) into v_visible
    from wishlist_claims where item_id = v_item;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: stranger % sees % claim(s) on an item they cannot see at all, expected 0',
      v_stranger, v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connecting role for the catalog checks below, as
  -- 14_tag_visibility.sql and 15_celebrated_materialization.sql do before
  -- their own pg_policies / has_table_privilege reads.
  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 4 (three checks): `authenticated` must hold none of INSERT,
  -- UPDATE or DELETE on this table at the PRIVILEGE layer, not merely be
  -- unable to use them via a missing policy. See the file header for why
  -- this is not automatically true just because the migration's GRANT line
  -- says `select` -- Supabase's per-role default privileges hand
  -- `authenticated` every DML verb on a new table unless explicitly revoked,
  -- confirmed live on wishlist_item_occasions before this migration's
  -- `revoke` line was added to close the same gap here.
  ---------------------------------------------------------------------------
  select has_table_privilege('authenticated', 'public.wishlist_claims', 'INSERT')
    into v_priv_insert;

  if v_priv_insert is distinct from false then
    raise exception
      'WRITE PATH: authenticated holds INSERT privilege on wishlist_claims, expected none. A direct insert would only be stopped by RLS, not by the grant layer, and a caller could still bypass the lapsed-claim release claim_wishlist_item() performs.';
  end if;
  v_checks := v_checks + 1;

  select has_table_privilege('authenticated', 'public.wishlist_claims', 'UPDATE')
    into v_priv_update;

  if v_priv_update is distinct from false then
    raise exception
      'WRITE PATH: authenticated holds UPDATE privilege on wishlist_claims, expected none.';
  end if;
  v_checks := v_checks + 1;

  select has_table_privilege('authenticated', 'public.wishlist_claims', 'DELETE')
    into v_priv_delete;

  if v_priv_delete is distinct from false then
    raise exception
      'WRITE PATH: authenticated holds DELETE privilege on wishlist_claims, expected none.';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5 (two checks): population control at the POLICY layer,
  -- independent of assertion 4's privilege-layer check. Zero policies for
  -- any write command (a permissive policy for any one of them would be
  -- enough to admit rows regardless of the privilege grant), and exactly one
  -- SELECT policy -- catching a second, additional permissive SELECT policy
  -- that would be ORed in alongside the correct owner-excluding one, which is
  -- exactly the shape of phase 2's live incident on
  -- wishlist_item_occasions and would be invisible to any check that filters
  -- by expression text.
  ---------------------------------------------------------------------------
  select count(*) into v_write_policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'wishlist_claims'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_write_policies <> 0 then
    raise exception
      'WRITE PATH: % write polic(y/ies) (INSERT/UPDATE/DELETE/ALL) exist on wishlist_claims, expected 0. All writes must go through claim_wishlist_item()/release_wishlist_claim().',
      v_write_policies;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_select_policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'wishlist_claims'
     and cmd = 'SELECT'
     -- PERMISSIVE only. A RESTRICTIVE SELECT policy narrows rather than
     -- widens, so it cannot reopen owner visibility; counting it here would
     -- fail this assertion for a change that is safe.
     and permissive = 'PERMISSIVE';

  if v_select_policies <> 1 then
    raise exception
      'WRITE PATH: % SELECT polic(y/ies) exist on wishlist_claims, expected exactly 1. A second permissive SELECT policy would be ORed in alongside the owner-excluding one and could reopen owner visibility invisibly to assertion 2.',
      v_select_policies;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 8 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 8', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_16_claim_visibility');
end $$;

select token as result from _harness_result;
