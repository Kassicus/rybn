-- get_upcoming_occasions() must derive birthdays with the SAME privacy as the
-- underlying profile_info field, and must key each celebrant's birthday ONCE
-- -- never once per shared group.
--
-- profile_info holds zero rows in production (see the task report), so this
-- file is the only real exercise of the derived branch of
-- get_upcoming_occasions(). It asserts three things, in order:
--
--   1. a birthday with visibleToGroupTypes: [] (this schema's spelling of
--      private -- see 01_wishlist_isolation.sql) does NOT appear for a
--      co-member;
--   2. the SAME birthday DOES appear once it is made visible to the shared
--      group's type, so assertion 1 is not vacuous;
--   3. it appears exactly ONCE for a viewer who ends up sharing TWO groups
--      with the celebrant -- the regression guard for per-celebrant keying.
--      get_upcoming_occasions()'s derived branch never joins group_members;
--      it calls can_view_field() as a scalar predicate over ALL shared
--      groups, so an extra shared group must change visibility, never row
--      count. An implementation that instead joined through group_members to
--      test visibility would fan this out into two rows here.
--
-- Convention: see 00_harness_smoke.sql. All fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; only the ASSERTIONS run
-- as `authenticated`, so `role` is toggled back to the captured
-- `current_user` around each fixture mutation and, finally, before the token
-- insert. `request.jwt.claims` is set once, for the viewer, and left alone --
-- only `role` moves -- since requesting_user_id() reads the claims, not the
-- role.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role   text;
  v_checks      int := 0;
  v_celeb       text := 'user_deriv_celeb';
  v_viewer      text := 'user_deriv_viewer';
  v_group1      uuid;
  v_group2      uuid;
  v_bday_value  text;
  v_visible     int;
begin
  select current_user into v_orig_role;

  -- Month-day only 10 days out, so the derived occasion always falls inside
  -- get_upcoming_occasions()'s default 30-day window regardless of which
  -- year the suite happens to run in. The stored year is arbitrary.
  v_bday_value := '1985-' || to_char(current_date + 10, 'MM-DD');

  insert into user_profiles (id, username, display_name)
    values (v_celeb,  'derivcelebrant', 'Deriv Celebrant'),
           (v_viewer, 'derivviewer',    'Deriv Viewer');

  insert into groups (name, type, invite_code, created_by)
    values ('Deriv Family', 'family', 'DERIVFAM', v_celeb)
    returning id into v_group1;

  -- add_group_creator_as_owner() already added v_celeb. v_viewer joins too,
  -- so the assertions below prove exclusion/inclusion despite (not absent)
  -- shared group membership.
  insert into group_members (group_id, user_id, role)
    values (v_group1, v_viewer, 'member')
    on conflict do nothing;

  -- Private birthday: visibleToGroupTypes is empty, this schema's spelling of
  -- "nobody but the owner can see this field" (see 01_wishlist_isolation.sql).
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_celeb, 'dates', 'birthday', v_bday_value,
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  -- Claims fixed to the viewer for every assertion below. Only `role` moves.
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_viewer || '","role":"authenticated"}', true);

  ---------------------------------------------------------------------------
  -- Assertion 1: a co-member must NOT see the private birthday, even though
  -- they share a group with the celebrant.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from public.get_upcoming_occasions()
    where celebrant_id = v_celeb and kind = 'birthday';

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: co-member % sees % private birthday occasion(s) of %, expected 0',
      v_viewer, v_visible, v_celeb;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: once the field is made visible to the shared group's type,
  -- the SAME birthday DOES appear -- proving assertion 1 excluded on
  -- privacy, not on a broken query that hides everything.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  update profile_info
    set privacy_settings = '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'
    where user_id = v_celeb and category = 'dates' and field_name = 'birthday';

  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from public.get_upcoming_occasions()
    where celebrant_id = v_celeb and kind = 'birthday';

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: co-member % sees % birthday occasion(s) of % once visible to their shared group type, expected 1',
      v_viewer, v_visible, v_celeb;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: a SECOND shared group must not fan the birthday out into a
  -- second row. Per-celebrant keying regression guard.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  insert into groups (name, type, invite_code, created_by)
    values ('Deriv Friends', 'friends', 'DERIVFRD', v_celeb)
    returning id into v_group2;

  insert into group_members (group_id, user_id, role)
    values (v_group2, v_viewer, 'member')
    on conflict do nothing;

  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from public.get_upcoming_occasions()
    where celebrant_id = v_celeb and kind = 'birthday';

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: co-member % sharing TWO groups with % sees % birthday occasion(s), expected exactly 1',
      v_viewer, v_celeb, v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connect role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  if v_checks < 3 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 3', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_12_occasion_derivation');
end $$;

select token as result from _harness_result;
