-- A group date must be visible to that group's members and to nobody else,
-- AND a celebrated occasion (birthday/anniversary) must inherit the
-- underlying profile_info field's privacy exactly.
--
-- The second half closes a coverage gap found in review: the "Celebrated
-- occasions follow the underlying date's privacy" policy shipped live and
-- untested in either direction. Nothing would have caught a regression in
-- the category/field_name join or the can_view_field argument order.
--
-- Asserted in both directions throughout, as 01_wishlist_isolation.sql
-- explains: a denied viewer seeing zero is vacuous unless another viewer is
-- also proven to see one.
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
           ('user_occ_b', 'occuser_b', 'Occ B'),
           ('user_occ_c', 'occuser_c', 'Occ C');

  insert into groups (name, type, invite_code, created_by)
    values ('Occ Family', 'family', 'OCCTEST1', 'user_occ_a')
    returning id into v_group;

  -- add_group_creator_as_owner() already added user_occ_a. user_occ_b stays
  -- out. user_occ_c (the celebrant below) joins too, so the privacy checks
  -- below prove exclusion despite shared group membership, not merely
  -- absence of one.
  insert into group_members (group_id, user_id, role)
    values (v_group, 'user_occ_c', 'member')
    on conflict do nothing;

  insert into occasions (group_id, kind, name, occasion_date, created_by)
    values (v_group, 'group_date', 'Christmas 2026', '2026-12-25', 'user_occ_a');

  -- user_occ_c's birthday, private by the schema's convention for "private"
  -- (an EMPTY visibleToGroupTypes array -- see 01_wishlist_isolation.sql).
  -- Sharing a family group with user_occ_a proves nothing on its own; the
  -- point is that the field stays hidden EVEN THOUGH they are groupmates.
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values ('user_occ_c', 'dates', 'birthday', '1990-06-15',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  insert into occasions (celebrant_id, kind, occasion_date)
    values ('user_occ_c', 'birthday', '1990-06-15');

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

  ---------------------------------------------------------------------------
  -- A groupmate whose group type is excluded by privacy_settings must see
  -- zero celebrated occasions, even though they share a group with the
  -- celebrant. (Claims are already user_occ_a from the check above.)
  ---------------------------------------------------------------------------
  select count(*) into v_visible
    from occasions where celebrant_id = 'user_occ_c';

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: groupmate user_occ_a sees % celebrated occasion(s) of user_occ_c, expected 0 (privacy_settings excludes every group type)',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The celebrant must still see their own, or the assertion above passed
  -- vacuously. can_view_field()'s owner short-circuit means privacy_settings
  -- never gates the celebrant's own view.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_occ_c","role":"authenticated"}', true);

  select count(*) into v_visible
    from occasions where celebrant_id = 'user_occ_c';

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: celebrant user_occ_c sees % of their own celebrated occasion(s), expected 1',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connect role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  if v_checks < 4 then
    raise exception 'RLS FAIL: only % checks ran, expected 4', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_11_occasion_visibility');
end $$;

select token as result from _harness_result;
