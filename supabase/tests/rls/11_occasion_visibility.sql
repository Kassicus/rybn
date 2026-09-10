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

  -- Back to the connect role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  if v_checks < 2 then
    raise exception 'RLS FAIL: only % checks ran, expected 2', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_11_occasion_visibility');
end $$;

select token as result from _harness_result;
