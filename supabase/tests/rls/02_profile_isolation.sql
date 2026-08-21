-- profile_info rows marked private must not leak to strangers.
--
-- Asserted in both directions. The brief's draft only checked that the
-- stranger sees zero; that assertion passes just as happily against a
-- profile_info table nobody can read at all, so it cannot distinguish "the
-- privacy rule works" from "the whole table is dark". The owner-side
-- assertion is what closes that, and it is what makes the mutation proof in
-- Task 3 Step 13 possible in the removal direction.
--
-- Privacy shape: an empty visibleToGroupTypes array with a null
-- restrictToGroup is how can_view_field() reads "only the owner".

create temp table _harness_result (token text);

do $$
declare
  v_visible   int;
  v_orig_role text;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values ('user_test_c', 'testuser_c', 'Test C'),
           ('user_test_d', 'testuser_d', 'Test D');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values ('user_test_d', 'sizes', 'shirt', 'L',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  ---------------------------------------------------------------------------
  -- A stranger sees nothing.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_c","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from profile_info where user_id = 'user_test_d';

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: user_test_c sees % private profile field(s) of user_test_d',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The owner still sees their own.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_d","role":"authenticated"}', true);

  select count(*) into v_visible
    from profile_info where user_id = 'user_test_d';

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: owner user_test_d sees % of their own profile field(s), expected 1',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 2 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 2. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_02_profile_isolation');
end $$;

select token as result from _harness_result;
