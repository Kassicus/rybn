-- A tag is the OWNER's statement of intent (see the header on
-- public.wishlist_item_occasions, 20260911000002_wishlist_item_occasions.sql).
-- Reading a tag is gated by the ITEM's visibility -- can_view_wishlist_item()
-- -- not by anything about the occasion, so this test never has to fake
-- occasion visibility to make its point; any occasion row serves.
--
-- CORRECTION (post-review, round 1): a first cut of this file claimed
-- assertions 1/2 below would break if the can_view_wishlist_item() call were
-- deleted from the SELECT policy's USING clause. That claim is false, and was
-- never actually checked. wishlist_items has its own RLS, with two SELECT
-- policies (clerk_native_baseline.sql:1573-1583) that already union to
-- exactly "own item OR can_view_wishlist_item(user_id, me, privacy_settings)"
-- -- identical in shape to the conjunct this policy adds. The EXISTS subquery
-- below runs AS the querying role, so it is itself filtered by that upstream
-- RLS. Deleting the can_view_wishlist_item() call from THIS policy and rerunning
-- would still pass every read assertion here, because wishlist_items' own
-- policies are already doing the whole job. The call is deliberate defence in
-- depth (see the migration's comment at the policy site), and this file
-- cannot distinguish which of the two layers is holding the line -- proving
-- that would require changing wishlist_items itself, which is out of scope
-- for this table's test. Assertions 1-4 below are still falsifiable by other
-- changes (see the per-assertion notes), just not by that one.
--
-- Asserted in both directions, as 01_wishlist_isolation.sql explains: a
-- stranger seeing zero tags on a private item is vacuous unless the item's
-- owner is also proven to see one (assertion 2). And "the gate follows item
-- visibility" is not proven by "nobody but the owner can see anything" --
-- assertion 4 proves a co-member the item IS shared with actually sees the
-- tag, which is also what catches an inverted can_view_wishlist_item()
-- argument order: with owner and viewer the same person (assertions 1-2),
-- swapping (owner, viewer) leaves both arguments pointing at the same id and
-- the swap is invisible; assertion 4 is the first place owner != viewer, so
-- it is the one a swap would actually flip.
--
-- WRITE-PATH ASSERTIONS (round 1 additions/fixes).
--
-- Assertion 3 (owner's own INSERT succeeds and persists) is the POSITIVE
-- counterpart the INSERT policy needs: nothing before this round ever
-- exercised that policy live -- every fixture row was written while
-- impersonating the RLS-bypassing connecting role. A denied INSERT raises an
-- unconditional, uncatchable error (confirmed directly against this project:
-- 42501 "new row violates row-level security policy", not silently filtered
-- the way a SELECT's USING clause is; ON CONFLICT DO NOTHING does not
-- suppress it either -- the conflict target is never reached, because WITH
-- CHECK runs first), so only the succeeding direction is safe to attempt
-- live inside this harness; see assertions 6-7 for the denial side.
--
-- Assertion 5 (a non-owner's DELETE has no effect) closes the round 1 review
-- gap head-on: unlike INSERT, a DELETE's USING clause FILTERS rows rather
-- than raising on a denial, so "attempt it, then count" is directly
-- expressible with no exception handler and no harness fight. There is no
-- excuse for this one being an inventory check.
--
-- Assertions 6-7 (the INSERT policy's WITH CHECK) replace round 0's
-- substring LIKE match, which two real regressions could pass while opening
-- a live hole:
--   - disjunctive weakening: `with check ((...ownership...) or
--     (...can_view_wishlist_item(...)...))` still contains the ownership
--     substring, still exactly one INSERT policy, but now admits any viewer.
--   - broken correlation: dropping `wi.id = wishlist_item_occasions.item_id`
--     from the subquery still contains the ownership substring, but now
--     admits tagging ANY item as long as the caller owns at least one.
-- Both are caught by asserting EQUALITY against the exact expression
-- pg_get_expr() (via pg_policies, a normalized deparse -- stable across
-- whitespace and, unlike pg_get_functiondef(), incapable of containing a
-- comment to hide a removed guard behind) returns for the policy AS SHIPPED,
-- captured directly from this project after applying
-- 20260911000002_wishlist_item_occasions.sql. Assertion 7 (total INSERT
-- policy count = 1, not filtered by text) closes the remaining gap equality
-- alone would still miss: a SECOND, additional permissive INSERT policy
-- alongside an unchanged correct one -- Postgres ORs multiple permissive
-- policies for the same command together, so an unrelated new policy would
-- not be counted by assertion 6's WHERE clause at all, and stay invisible to
-- it.
--
-- What assertions 6-7 together do NOT catch, stated plainly per review's
-- request: a regression inside public.requesting_user_id() itself (covered
-- by 05_definer_pins.sql, not here); the policy's `to authenticated` role
-- clause going missing (covered by 06_anon_has_no_reach.sql); anything about
-- the SELECT or DELETE policies on this table (covered by assertions
-- 1/2/4/5); and a functionally-equivalent but differently-worded rewrite of
-- the SAME correct predicate, which would make assertion 6 FAIL even though
-- nothing is actually wrong -- a false-positive cost of exact-text matching,
-- accepted deliberately in exchange for closing the two real false-negative
-- holes above.
--
-- Assertion 8 (no UPDATE policy) is the catalog-count-zero idiom
-- 07_write_path_defences.sql:136-139 already established for "this table
-- must have no policy for this command at all" (there used for
-- group_members' INSERT). What it does NOT catch, also stated plainly: an
-- `alter table ... disable row level security` on this table would leave
-- zero UPDATE policies (this check would stay green) while RLS enforcement
-- vanished entirely for every command -- but that particular regression
-- would surface via assertions 1, 2, 4 and 5 in THIS SAME FILE instead,
-- since every one of them depends on RLS actually being enforced at all; it
-- is only assertion 8 in isolation that cannot see it. It also does not
-- catch an UPDATE reaching the table through a SECURITY DEFINER function or
-- trigger that bypasses RLS by construction -- this inventories declarative
-- policies only, not every code path capable of writing to the table.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; only the read/write
-- assertions run as `authenticated`, so `role` is toggled back to the
-- captured `current_user` around fixture mutations and, finally, before the
-- catalog checks and the token insert.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role       text;
  v_checks          int := 0;
  v_owner           text := 'user_tag_owner';
  v_stranger        text := 'user_tag_stranger';
  v_comember        text := 'user_tag_comember';
  v_group           uuid;
  v_private_item    uuid;
  v_visible_item    uuid;
  v_insert_item     uuid;
  v_occasion        uuid;
  v_visible         int;
  v_del_rows        int;
  v_ins_check       int;
  v_ins_total       int;
  v_upd_total       int;
  -- Captured directly from pg_policies against this project immediately
  -- after applying 20260911000002_wishlist_item_occasions.sql -- the exact
  -- pg_get_expr() deparse of "Owners tag their own items"'s WITH CHECK.
  -- Real embedded newlines, matched exactly, not a substring.
  v_expected_ins_check text := '(EXISTS ( SELECT 1
   FROM wishlist_items wi
  WHERE ((wi.id = wishlist_item_occasions.item_id) AND (wi.user_id = ( SELECT requesting_user_id() AS requesting_user_id)))))';
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values (v_owner,    'tagowner',    'Tag Owner'),
           (v_stranger, 'tagstranger', 'Tag Stranger'),
           (v_comember, 'tagcomember', 'Tag Comember');

  insert into groups (name, type, invite_code, created_by)
    values ('Tag Family', 'family', 'TAGFAM01', v_owner)
    returning id into v_group;

  -- add_group_creator_as_owner() already added v_owner. v_comember joins too;
  -- v_stranger stays out, so assertion 1 proves exclusion from a group the
  -- stranger never belonged to, not merely a coincidence of fixture layout.
  insert into group_members (group_id, user_id, role)
    values (v_group, v_comember, 'member')
    on conflict do nothing;

  -- Private, per this schema's convention: an EMPTY visibleToGroupTypes
  -- array (see 01_wishlist_isolation.sql / valid_wishlist_privacy_settings).
  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'Private Item',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}')
    returning id into v_private_item;

  -- Visible to the "family" group type, which v_comember shares with the
  -- owner and v_stranger does not.
  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'Visible Item',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_visible_item;

  -- A THIRD item, owned by v_owner, deliberately left UNTAGGED by the
  -- fixture -- assertion 3 tags it live, as the owner, under RLS.
  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'Insert Target Item',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}')
    returning id into v_insert_item;

  -- Any occasion serves every assertion below: the SELECT/INSERT/DELETE
  -- policies on this table all gate on the ITEM, never the occasion.
  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_owner, 'birthday', '1990-06-15')
    returning id into v_occasion;

  -- Pre-existing tags for the read assertions (1, 2, 4) and the delete
  -- assertion (5). v_insert_item is deliberately NOT tagged here.
  insert into wishlist_item_occasions (item_id, occasion_id)
    values (v_private_item, v_occasion), (v_visible_item, v_occasion);

  ---------------------------------------------------------------------------
  -- Assertion 1: a stranger, sharing no group with the owner, must not see
  -- the tag on the PRIVATE item.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_stranger || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from wishlist_item_occasions where item_id = v_private_item;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: stranger % sees % tag(s) on a private item, expected 0',
      v_stranger, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: the item's OWNER must still see that same tag, or
  -- assertion 1 passed vacuously on a table nobody can read at all.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);

  select count(*) into v_visible
    from wishlist_item_occasions where item_id = v_private_item;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: owner % sees % tag(s) on their own private item, expected 1',
      v_owner, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: the POSITIVE path for the INSERT policy. Still
  -- impersonating the owner from assertion 2 -- they tag their own,
  -- previously-untagged item live, under RLS, and the row must persist.
  -- Breaks if the INSERT policy is ever tightened past what a legitimate
  -- owner-authored tag needs (the write equivalent of 07_write_path_defences
  -- .sql's 3f, which exists for the identical reason).
  ---------------------------------------------------------------------------
  insert into wishlist_item_occasions (item_id, occasion_id)
    values (v_insert_item, v_occasion);

  select count(*) into v_visible
    from wishlist_item_occasions
   where item_id = v_insert_item and occasion_id = v_occasion;

  if v_visible <> 1 then
    raise exception
      'WRITE PATH: owner % inserted a tag on their own item but % row(s) exist afterward, expected 1',
      v_owner, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: a co-member who CAN see the item (it is shared with their
  -- group type) must see the tag too -- proving the gate follows item
  -- visibility rather than blocking every non-owner outright. This is also
  -- the assertion an inverted can_view_wishlist_item() argument order would
  -- flip: it is the first case above where owner and viewer differ.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_comember || '","role":"authenticated"}', true);

  select count(*) into v_visible
    from wishlist_item_occasions where item_id = v_visible_item;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: co-member % sees % tag(s) on an item visible to their group, expected 1',
      v_comember, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: the NEGATIVE path for the DELETE policy. Still
  -- impersonating the co-member -- they can SEE this tag (assertion 4 just
  -- proved it) but do not own the item, so their DELETE must remove nothing.
  -- Unlike INSERT, a denied DELETE filters silently (USING excludes the row
  -- rather than raising), so this is directly assertable: no exception
  -- handler, no harness fight. Breaks if the DELETE policy is ever loosened
  -- from ownership to visibility -- exactly the regression that would let a
  -- co-member retract another user's stated intent.
  ---------------------------------------------------------------------------
  delete from wishlist_item_occasions
   where item_id = v_visible_item and occasion_id = v_occasion;
  get diagnostics v_del_rows = row_count;

  -- Back to the connect role before re-checking: the co-member should not be
  -- ABLE to see whether the row survived, but the harness needs an
  -- unfiltered count to tell "correctly denied" from "correctly empty".
  perform set_config('role', v_orig_role, true);

  select count(*) into v_visible
    from wishlist_item_occasions
   where item_id = v_visible_item and occasion_id = v_occasion;

  if v_del_rows <> 0 or v_visible <> 1 then
    raise exception
      'WRITE PATH: co-member % deleted % row(s) of a tag they do not own, and % row(s) remain -- expected 0 deleted and 1 remaining',
      v_comember, v_del_rows, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: the INSERT policy's WITH CHECK must equal the expression it
  -- shipped with, exactly -- not merely contain a fragment of it. See the
  -- file header for the two regressions a substring match would have missed.
  ---------------------------------------------------------------------------
  select count(*) into v_ins_check
    from pg_policies
   where schemaname = 'public'
     and tablename = 'wishlist_item_occasions'
     and cmd = 'INSERT'
     and with_check = v_expected_ins_check;

  if v_ins_check <> 1 then
    raise exception
      'WRITE PATH: the wishlist_item_occasions INSERT policy''s WITH CHECK no longer matches the expression it shipped with (matched % polic(y/ies), expected 1). A viewer who can merely SEE an item, or a caller who owns ANY item, may now be able to tag one that is not theirs.',
      v_ins_check;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: population control for assertion 6. Equality alone would
  -- not notice a SECOND, additional permissive INSERT policy sitting
  -- alongside an unchanged correct one -- Postgres ORs permissive policies
  -- for the same command, and assertion 6's WHERE clause only counts rows
  -- matching the expected text, so a new unrelated policy is invisible to
  -- it. This counts ALL INSERT policies on the table, filtered by nothing.
  ---------------------------------------------------------------------------
  select count(*) into v_ins_total
    from pg_policies
   where schemaname = 'public'
     and tablename = 'wishlist_item_occasions'
     and cmd = 'INSERT';

  if v_ins_total <> 1 then
    raise exception
      'WRITE PATH: % INSERT polic(y/ies) exist on wishlist_item_occasions, expected exactly 1. An additional permissive policy would be ORed in alongside the correct one and admit rows it should not.',
      v_ins_total;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: no UPDATE policy exists at all -- the deliberate design
  -- from the migration's own comment ("a tag has no mutable field"). RLS
  -- enabled plus zero applicable policies for a command means that command
  -- is denied outright (00_harness_smoke.sql's own probe demonstrates the
  -- same principle); this inventories that the catalog still agrees.
  ---------------------------------------------------------------------------
  select count(*) into v_upd_total
    from pg_policies
   where schemaname = 'public'
     and tablename = 'wishlist_item_occasions'
     and cmd = 'UPDATE';

  if v_upd_total <> 0 then
    raise exception
      'WRITE PATH: % UPDATE polic(y/ies) exist on wishlist_item_occasions, expected 0. A tag has no mutable field; an UPDATE policy reopens the same shape of hole the occasions UPDATE policy shipped with in phase 1.',
      v_upd_total;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 8 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 8', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_14_tag_visibility');
end $$;

select token as result from _harness_result;
