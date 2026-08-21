-- Group rows, and the membership rows behind them, are visible only to
-- members -- and the membership policies must not recurse.
--
-- Recursion is the failure this schema has hit repeatedly (see the archived
-- migrations named fix_rls_recursion, simple_rls_no_recursion,
-- fix_group_gift_members_recursion). It does not show up as a wrong count; it
-- shows up as `stack depth limit exceeded`, which the runner reports as a
-- failure of this file. That is why the group_members read is asserted here
-- and not only the groups read: a policy on group_members that queries
-- group_members is exactly what SECURITY DEFINER helpers exist to prevent.
--
-- Both directions again: a non-member must see nothing, a member must see
-- their own rows. Without the member-side assertions a completely dark
-- groups table would pass.

create temp table _harness_result (token text);

do $$
declare
  v_visible   int;
  v_group_id  uuid;
  v_orig_role text;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values ('user_test_e', 'testuser_e', 'Test E'),
           ('user_test_f', 'testuser_f', 'Test F');

  insert into groups (name, type, invite_code, created_by)
    values ('Test Group', 'family', 'TESTCODE1', 'user_test_e')
    returning id into v_group_id;

  -- The on_group_created trigger already adds the creator as owner; this is
  -- belt and braces, hence the conflict clause.
  insert into group_members (group_id, user_id, role)
    values (v_group_id, 'user_test_e', 'owner')
    on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Non-member: sees neither the group nor its roster.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_f","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from groups where id = v_group_id;
  if v_visible <> 0 then
    raise exception 'RLS FAIL: non-member sees group (count=%)', v_visible;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_visible from group_members where group_id = v_group_id;
  if v_visible <> 0 then
    raise exception
      'RLS FAIL: non-member sees % membership row(s) of a group they are not in',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Member: sees both.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_e","role":"authenticated"}', true);

  select count(*) into v_visible from groups where id = v_group_id;
  if v_visible <> 1 then
    raise exception 'RLS FAIL: member sees % of their group, expected 1', v_visible;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_visible from group_members where group_id = v_group_id;
  if v_visible <> 1 then
    raise exception
      'RLS FAIL: member sees % membership row(s) of their own group, expected 1',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 4 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 4. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_03_group_membership');
end $$;

select token as result from _harness_result;
