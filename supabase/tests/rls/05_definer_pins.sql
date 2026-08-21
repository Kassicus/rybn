-- The SECURITY DEFINER membership helpers must not answer questions about
-- other people.
--
-- is_group_member, is_group_admin, is_group_owner, is_group_gift_member and
-- is_exchange_participant run with RLS suspended, are executable by
-- `authenticated`, and PostgREST exposes them at /rest/v1/rpc/. Unpinned, they
-- answer exactly what RLS refuses to: an unrelated signed-in user could ask
-- is_group_gift_member(<gift>, 'alice') and learn who a surprise gift involves,
-- or is_exchange_participant(<exchange>, 'bob') and learn a Secret Santa
-- roster. A group UUID kept after leaving a group makes that oracle permanent.
--
-- Every negative assertion here is paired with a positive control. "Everything
-- returns false" would otherwise pass against helpers that had simply been
-- broken -- and these five are what all 62 policies are built on, so breaking
-- them would take the whole policy layer down while this file stayed green.
--
-- The probe user is `authenticated`, not the connect role, so this also
-- confirms pinning did not cost `authenticated` the EXECUTE it genuinely needs
-- for policy evaluation.

create temp table _harness_result (token text);

do $$
declare
  v_pg        uuid;
  v_sg        uuid;
  v_gift      uuid;
  v_exchange  uuid;
  v_settings  jsonb;
  v_bool      boolean;
  v_count     int;
  v_orig_role text;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values ('user_n1_probe',  'n1probe',  'Probe'),
           ('user_n1_peer',   'n1peer',   'Peer'),
           ('user_n1_victim', 'n1victim', 'Victim'),
           ('user_n1_other',  'n1other',  'Other');

  -- The probe user's own group, and a group they have nothing to do with.
  insert into groups (name, type, invite_code, created_by)
    values ('N1 Probe Group', 'family', 'N1CODE01', 'user_n1_probe')
    returning id into v_pg;

  insert into groups (name, type, invite_code, created_by)
    values ('N1 Secret Group', 'family', 'N1CODE02', 'user_n1_victim')
    returning id into v_sg;

  insert into group_members (group_id, user_id, role)
    values (v_pg, 'user_n1_peer',  'member'),
           (v_sg, 'user_n1_other', 'member')
    on conflict do nothing;

  insert into group_gifts (group_id, name, created_by)
    values (v_sg, 'Secret Gift', 'user_n1_victim')
    returning id into v_gift;

  insert into group_gift_members (group_gift_id, user_id)
    values (v_gift, 'user_n1_victim');

  insert into gift_exchanges (group_id, name, created_by)
    values (v_sg, 'Secret Santa', 'user_n1_victim')
    returning id into v_exchange;

  insert into gift_exchange_participants (exchange_id, user_id)
    values (v_exchange, 'user_n1_victim');

  v_settings := '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'::jsonb;

  ---------------------------------------------------------------------------
  -- The probe: an unrelated signed-in user asking about the victim.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_n1_probe","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.is_group_member(v_sg, 'user_n1_victim') into v_bool;
  if v_bool is not false then
    raise exception 'PIN FAIL: is_group_member leaks the victim group membership';
  end if;
  v_checks := v_checks + 1;

  select public.is_group_admin(v_sg, 'user_n1_victim') into v_bool;
  if v_bool is not false then
    raise exception 'PIN FAIL: is_group_admin leaks the victim admin status';
  end if;
  v_checks := v_checks + 1;

  select public.is_group_owner(v_sg, 'user_n1_victim') into v_bool;
  if v_bool is not false then
    raise exception 'PIN FAIL: is_group_owner leaks the victim ownership';
  end if;
  v_checks := v_checks + 1;

  select public.is_group_gift_member(v_gift, 'user_n1_victim') into v_bool;
  if v_bool is not false then
    raise exception 'PIN FAIL: is_group_gift_member leaks who a surprise gift involves';
  end if;
  v_checks := v_checks + 1;

  select public.is_exchange_participant(v_exchange, 'user_n1_victim') into v_bool;
  if v_bool is not false then
    raise exception 'PIN FAIL: is_exchange_participant leaks a Secret Santa roster';
  end if;
  v_checks := v_checks + 1;

  -- The owner-sees-own shortcut makes the true answer TRUE, so a false result
  -- here can only have come from the pin.
  select public.can_view_field('user_n1_victim', 'user_n1_victim', v_settings) into v_bool;
  if v_bool is not false then
    raise exception 'PIN FAIL: can_view_field answers for the victim viewpoint';
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from public.get_shared_groups('user_n1_victim', 'user_n1_other');
  if v_count <> 0 then
    raise exception
      'PIN FAIL: get_shared_groups maps % group(s) between two other users', v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Positive controls. The pin must leave the truth intact for the caller
  -- themselves, or it has simply broken the policy layer.
  ---------------------------------------------------------------------------
  select public.is_group_member(v_pg, 'user_n1_probe') into v_bool;
  if v_bool is not true then
    raise exception 'PIN FAIL: is_group_member denies the caller their own membership';
  end if;
  v_checks := v_checks + 1;

  select public.is_group_owner(v_pg, 'user_n1_probe') into v_bool;
  if v_bool is not true then
    raise exception 'PIN FAIL: is_group_owner denies the caller their own ownership';
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from public.get_shared_groups('user_n1_probe', 'user_n1_peer');
  if v_count <> 1 then
    raise exception
      'PIN FAIL: get_shared_groups returns % for a pair the caller belongs to, expected 1',
      v_count;
  end if;
  v_checks := v_checks + 1;

  -- And the victim still gets the truth about themselves.
  perform set_config('request.jwt.claims',
    '{"sub":"user_n1_victim","role":"authenticated"}', true);

  select public.is_group_gift_member(v_gift, 'user_n1_victim') into v_bool;
  if v_bool is not true then
    raise exception 'PIN FAIL: is_group_gift_member denies the victim their own gift membership';
  end if;
  v_checks := v_checks + 1;

  select public.is_exchange_participant(v_exchange, 'user_n1_victim') into v_bool;
  if v_bool is not true then
    raise exception 'PIN FAIL: is_exchange_participant denies the victim their own participation';
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 12 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 12. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_05_definer_pins');
end $$;

select token as result from _harness_result;
