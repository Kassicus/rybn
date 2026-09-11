-- get_upcoming_occasions() must derive birthdays with the SAME privacy as the
-- underlying profile_info field, must key each celebrant's birthday ONCE --
-- never once per shared group -- and must never raise on a calendar-invalid
-- stored date. It also has a second branch, stored group_date rows, that RLS
-- does NOT protect: get_upcoming_occasions() is SECURITY DEFINER, so the
-- occasions policies 11_occasion_visibility.sql exercises never run inside
-- it. The only gate on that branch is the is_group_member() call in its
-- WHERE clause, and this file is the only test of it.
--
-- profile_info holds zero rows in production (see the task report), so this
-- file is the only real exercise of the derived branch of
-- get_upcoming_occasions(). It asserts, in order (10 checks total):
--
--   1. a birthday with visibleToGroupTypes: [] (this schema's spelling of
--      private -- see 01_wishlist_isolation.sql) does NOT appear for a
--      co-member;
--   2. the SAME birthday DOES appear once it is made visible to the shared
--      group's type, so assertion 1 is not vacuous;
--   3. it still appears exactly ONCE for a viewer who shares TWO groups with
--      the celebrant, where BOTH group types are listed in
--      visibleToGroupTypes and therefore BOTH independently grant
--      visibility -- the regression guard for per-celebrant keying.
--      get_upcoming_occasions()'s derived branch never joins group_members;
--      it calls can_view_field() once, as a scalar predicate over ALL shared
--      groups, so a SECOND group that also grants visibility must not
--      change the row count. An implementation that instead joined through
--      group_members and emitted one row per qualifying shared group would
--      emit TWO rows here, since both groups qualify -- proven directly in
--      the task report via can_view_field() called with each group's type in
--      isolation, both returning true, with a third type shared by neither
--      group returning false as a negative control;
--   4. (two checks) a calendar-invalid stored date (regex-shaped but not a
--      real day, e.g. 1990-06-31) evaluates to NULL through
--      celebration_date_in_year() directly, and a DIFFERENT profile_info row
--      holding one does not raise and does not hide or duplicate a
--      correctly-visible occasion in the same query -- the coverage gap
--      behind the Critical this file was revised for;
--   5. (two checks) the group_date branch: a non-member of the occasion's
--      group sees zero, and a member sees one;
--   6. a birthday/anniversary whose month-day already passed this year
--      resolves to NEXT year's date, not this year's -- the lateral join's
--      rollover arm.
--   7. (two checks) the Feb-29 clamp itself
--      (20260910100002_occasions_derivation.sql:34-39,
--      20260910100003_celebration_date_total.sql:60-65), called directly:
--      celebration_date_in_year('2000-02-29', 2027) -- 2027 being the exact
--      non-leap year the header comment on that function, and this suite's
--      own migration, cite as the original 22008 outage -- must clamp to
--      2027-02-28, and celebration_date_in_year('2000-02-29', 2028), the
--      very next leap year, must return 2028-02-29 unclamped. The second
--      check is what makes the first a real clamp rather than
--      celebration_date_in_year() simply refusing every Feb-29 input. This
--      function ships live in production and was, until this revision,
--      asserted nowhere in this repo (grep -rn "02-29|leap|Feb" across
--      supabase/tests, lib, components returned nothing) -- despite being
--      the exact latent outage (SQLSTATE 22008, breaking the nightly
--      reminder cron for every user over a single Feb-29 birthday) this
--      whole helper exists to eliminate.
--
-- Convention: see 00_harness_smoke.sql. All fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; only the ASSERTIONS run
-- as `authenticated`, so `role` is toggled back to the captured
-- `current_user` around each fixture mutation and, finally, before the token
-- insert. `request.jwt.claims` stays pinned to the viewer throughout, except
-- for assertion 5's non-member check, which moves it briefly to an outsider
-- and back -- since requesting_user_id() reads the claims, not the role.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role     text;
  v_checks        int := 0;
  v_celeb         text := 'user_deriv_celeb';
  v_viewer        text := 'user_deriv_viewer';
  v_bad_celeb     text := 'user_deriv_bad';
  v_outsider      text := 'user_deriv_outsider';
  v_group1        uuid;
  v_group2        uuid;
  v_group_date_id uuid;
  v_bday_value    text;
  v_bad_value     text := '1990-06-31';
  v_anniv_value   text;
  v_visible       int;
  v_count_bad     int;
  v_count_good    int;
  v_null_check    date;
  v_occ_year      int;
begin
  select current_user into v_orig_role;

  -- Month-day only 10 days out, so the derived occasion always falls inside
  -- get_upcoming_occasions()'s default 30-day window regardless of which
  -- year the suite happens to run in. The stored year is arbitrary.
  v_bday_value := '1985-' || to_char(current_date + 10, 'MM-DD');

  -- Month-day 10 days in the PAST, for assertion 6's rollover check: its
  -- this-year date has already gone by, so the lateral join must roll it to
  -- next year. (Assumes the suite does not run in the first 10 days of
  -- January, same as the +10 fixture above assumes it does not run in the
  -- last 10 days of December -- both are pre-existing, accepted limits of a
  -- fixed-offset fixture, not new to this revision.)
  v_anniv_value := '1985-' || to_char(current_date - 10, 'MM-DD');

  insert into user_profiles (id, username, display_name)
    values (v_celeb,     'derivcelebrant', 'Deriv Celebrant'),
           (v_viewer,    'derivviewer',    'Deriv Viewer'),
           (v_bad_celeb, 'derivbaddate',   'Deriv Bad Date'),
           (v_outsider,  'derivoutsider',  'Deriv Outsider');

  insert into groups (name, type, invite_code, created_by)
    values ('Deriv Family', 'family', 'DERIVFAM', v_celeb)
    returning id into v_group1;

  -- add_group_creator_as_owner() already added v_celeb. v_viewer joins too,
  -- so the assertions below prove exclusion/inclusion despite (not absent)
  -- shared group membership. v_outsider stays out of every group, for
  -- assertion 5.
  insert into group_members (group_id, user_id, role)
    values (v_group1, v_viewer, 'member')
    on conflict do nothing;

  -- Private birthday: visibleToGroupTypes is empty, this schema's spelling of
  -- "nobody but the owner can see this field" (see 01_wishlist_isolation.sql).
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_celeb, 'dates', 'birthday', v_bday_value,
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  -- Claims fixed to the viewer for every assertion except 5's non-member
  -- check.
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
  -- Assertion 3: a SECOND shared group, whose type ALSO independently grants
  -- visibility, must not fan the birthday out into a second row. Both
  -- 'family' and 'friends' are listed, so both groups qualify on their own
  -- (see the task report's can_view_field() proof) -- a fanout
  -- implementation would emit 2 rows here, not 1.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  update profile_info
    set privacy_settings = '{"visibleToGroupTypes": ["family", "friends"], "restrictToGroup": null}'
    where user_id = v_celeb and category = 'dates' and field_name = 'birthday';

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
      'RLS FAIL: co-member % sharing TWO visibility-granting groups with % sees % birthday occasion(s), expected exactly 1',
      v_viewer, v_celeb, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4 (two checks): a calendar-invalid stored date must evaluate
  -- to NULL, not raise -- and a row holding one, anywhere in profile_info,
  -- must not break the query for a caller who has nothing to do with it.
  -- 1990-06-31 passes '^\d{4}-\d{2}-\d{2}$' but June has 30 days; this is
  -- the exact class of input Critical 1 found reaching
  -- celebration_date_in_year()'s bare cast.
  ---------------------------------------------------------------------------
  select public.celebration_date_in_year(v_bad_value, extract(year from current_date)::integer)
    into v_null_check;

  if v_null_check is not null then
    raise exception
      'HARNESS FAIL: celebration_date_in_year(%, ...) returned % instead of NULL',
      v_bad_value, v_null_check;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  -- v_bad_celeb shares no group with v_viewer at all. The point: the
  -- derived branch's lateral join computes celebration_date_in_year() for
  -- EVERY profile_info row before can_view_field() ever filters by privacy,
  -- so a bad row anywhere -- visible to this viewer or not, belonging to
  -- this viewer's groups or not -- must not crash the query.
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_bad_celeb, 'dates', 'birthday', v_bad_value,
            '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}');

  perform set_config('role', 'authenticated', true);

  select
    count(*) filter (where celebrant_id = v_bad_celeb) as bad_count,
    count(*) filter (where celebrant_id = v_celeb and kind = 'birthday') as good_count
    into v_count_bad, v_count_good
    from public.get_upcoming_occasions();

  if v_count_bad <> 0 or v_count_good <> 1 then
    raise exception
      'RLS FAIL: with a calendar-invalid dates row present, saw % bad-celebrant row(s) (expected 0) and % good birthday row(s) (expected 1) -- the malformed row broke or leaked into the query',
      v_count_bad, v_count_good;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5 (two checks): the group_date branch. get_upcoming_occasions()
  -- is SECURITY DEFINER, so occasions' own RLS policies never run inside it.
  -- The ONLY gate on this branch is the is_group_member() call in its WHERE
  -- clause, and nothing else in this suite touches it.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  insert into occasions (group_id, kind, name, occasion_date, created_by)
    values (v_group1, 'group_date', 'Deriv Christmas', current_date + 5, v_celeb)
    returning id into v_group_date_id;

  -- The outsider shares no group with anyone in this fixture.
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_outsider || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from public.get_upcoming_occasions()
    where occasion_id = v_group_date_id;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: non-member % sees % group-date occasion(s) in a group they never joined, expected 0',
      v_outsider, v_visible;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_viewer || '","role":"authenticated"}', true);

  select count(*) into v_visible
    from public.get_upcoming_occasions()
    where occasion_id = v_group_date_id;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: member % sees % group-date occasion(s) in their own group, expected 1 (the non-member check above would be vacuous otherwise)',
      v_viewer, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: year rollover. v_celeb's anniversary month-day already
  -- passed this year (stored 10 days in the past), so the lateral join in
  -- get_upcoming_occasions() must resolve it to NEXT year's date, not raise,
  -- and not silently drop it.
  --
  -- Called with p_days_ahead => 400, not the default 30: the whole point of
  -- this fixture is that THIS year's occurrence already passed, so the
  -- rolled-over occurrence can be up to ~365 days out depending on where in
  -- the calendar the suite happens to run (today, it is ~355 days out). A
  -- 30-day window would exclude it regardless of whether the rollover logic
  -- is correct, making the assertion vacuous by construction rather than by
  -- a real pass. 400 comfortably covers the full year-length gap.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_celeb, 'dates', 'anniversary', v_anniv_value,
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}');

  perform set_config('role', 'authenticated', true);

  select count(*), max(extract(year from occasion_date)::integer)
    into v_visible, v_occ_year
    from public.get_upcoming_occasions(400)
    where celebrant_id = v_celeb and kind = 'anniversary';

  if v_visible <> 1 or v_occ_year <> extract(year from current_date)::integer + 1 then
    raise exception
      'RLS FAIL: rollover anniversary resolved to % row(s) in year % (expected 1 row(s), year %)',
      v_visible, v_occ_year, extract(year from current_date)::integer + 1;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7 (two checks): the Feb-29 clamp itself, called directly --
  -- no fixture row needed, since celebration_date_in_year() is IMMUTABLE and
  -- takes no viewer. '2000-02-29' and 2027 are the exact field value and
  -- non-leap target year 20260910100002_occasions_derivation.sql's own
  -- header comment (and this file's own header above) cite as the original
  -- 22008 outage. A common year must clamp to Feb 28, the convention that
  -- function documents; the very next leap year, 2028, must return Feb 29
  -- UNclamped, proving the first check is a real clamp and not
  -- celebration_date_in_year() simply refusing every Feb-29 input.
  ---------------------------------------------------------------------------
  select public.celebration_date_in_year('2000-02-29', 2027) into v_null_check;

  if v_null_check <> date '2027-02-28' then
    raise exception
      'HARNESS FAIL: celebration_date_in_year(2000-02-29, 2027) returned %, expected 2027-02-28 (the common-year Feb-29 clamp)',
      v_null_check;
  end if;
  v_checks := v_checks + 1;

  select public.celebration_date_in_year('2000-02-29', 2028) into v_null_check;

  if v_null_check <> date '2028-02-29' then
    raise exception
      'HARNESS FAIL: celebration_date_in_year(2000-02-29, 2028) returned %, expected 2028-02-29 (a leap year must NOT be clamped)',
      v_null_check;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connect role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  if v_checks < 10 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 10', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_12_occasion_derivation');
end $$;

select token as result from _harness_result;
