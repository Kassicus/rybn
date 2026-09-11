-- A tag is the OWNER's statement of intent (see the header on
-- public.wishlist_item_occasions, 20260911000002_wishlist_item_occasions.sql).
-- Reading a tag is gated by the ITEM's visibility -- can_view_wishlist_item()
-- -- not by anything about the occasion, so this test never has to fake
-- occasion visibility to make its point; any occasion row serves.
--
-- Asserted in both directions, as 01_wishlist_isolation.sql explains: a
-- stranger seeing zero tags on a private item is vacuous unless the item's
-- owner is also proven to see one (assertion 2). And "the gate follows item
-- visibility" is not proven by "nobody but the owner can see anything" --
-- assertion 3 proves a co-member the item IS shared with actually sees the
-- tag, which is also what catches an inverted can_view_wishlist_item()
-- argument order: with owner and viewer the same person (assertions 1-2),
-- swapping (owner, viewer) leaves both arguments pointing at the same id and
-- the swap is invisible; assertion 3 is the first place owner != viewer, so
-- it is the one a swap would actually flip.
--
-- Assertion 4 (a non-owner's INSERT creates no row) cannot be spelled as
-- "attempt the insert, then count." Confirmed directly against this project:
-- a denied INSERT's WITH CHECK failure is a hard, unconditional error (42501,
-- "new row violates row-level security policy") -- unlike a SELECT's USING
-- clause, it is never silently filtered. ON CONFLICT DO NOTHING does not
-- suppress it either (tested directly: the conflict target is never reached,
-- because WITH CHECK is enforced against the proposed row before conflict
-- resolution runs). And per 13_occasion_materialization.sql's header, this
-- runner sends an entire file as ONE query: a raised, uncaught error discards
-- every statement after it, the token included, with no way to recover via
-- ROLLBACK TO SAVEPOINT because that statement never runs either. Catching
-- the error some other way is exactly what the harness rejects
-- (`exception when`). So, as 07_write_path_defences.sql's header explains for
-- the identical limitation on other write denials, this assertion is an
-- INVENTORY check: the INSERT policy's WITH CHECK, read back from
-- pg_policies (the compiled expression, not source text -- unlike
-- pg_get_functiondef() it cannot contain a comment to hide a removed guard
-- behind), must still require wi.user_id = the caller. Weakening that clause
-- -- for instance swapping ownership for can_view_wishlist_item(), which
-- would let a mere viewer tag somebody else's item -- flips this assertion.
-- The live behaviour (an actual attempt by a non-owner, refused with 42501)
-- was executed directly against this project outside this file and is
-- recorded in the task report, the same way 07_write_path_defences.sql's
-- header describes for its own checks.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; only the read
-- assertions run as `authenticated`, so `role` is toggled back to the
-- captured `current_user` around fixture mutations and, finally, before the
-- catalog check and the token insert.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role    text;
  v_checks       int := 0;
  v_owner        text := 'user_tag_owner';
  v_stranger     text := 'user_tag_stranger';
  v_comember     text := 'user_tag_comember';
  v_group        uuid;
  v_private_item uuid;
  v_visible_item uuid;
  v_occasion     uuid;
  v_visible      int;
  v_ins_check    int;
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

  -- Any occasion serves the read-path assertions below: the SELECT policy
  -- gates on the ITEM's visibility, never the occasion's.
  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_owner, 'birthday', '1990-06-15')
    returning id into v_occasion;

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
  -- Assertion 3: a co-member who CAN see the item (it is shared with their
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

  -- Back to the connect role before the catalog read and the token insert.
  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 4: the INSERT policy must still gate on ITEM OWNERSHIP. See
  -- the file header for why this cannot be a live attempted write.
  ---------------------------------------------------------------------------
  select count(*) into v_ins_check
    from pg_policies
   where schemaname = 'public'
     and tablename = 'wishlist_item_occasions'
     and cmd = 'INSERT'
     and with_check like '%wi.user_id = ( SELECT requesting_user_id() AS requesting_user_id)%';

  if v_ins_check <> 1 then
    raise exception
      'WRITE PATH: the wishlist_item_occasions INSERT policy no longer requires item ownership (matched % policy/policies, expected 1). A viewer who can merely SEE an item would be able to tag it, putting words in the owner''s mouth.',
      v_ins_check;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 4 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 4', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_14_tag_visibility');
end $$;

select token as result from _harness_result;
