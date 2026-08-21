-- Group-scoped privacy overrides must behave as they did before the
-- uuid -> text change of the identity parameters.
--
-- can_view_field() is the most intricate logic in the schema and its two user
-- parameters change type, so it is the likeliest place for a silent
-- regression: a comparison that used to match on uuid equality and now
-- silently never matches would leave every overridden field invisible, and a
-- comparison that stopped filtering at all would make every overridden field
-- world-readable. Both directions are asserted, plus the owner's own access.
--
-- SHAPE NOTE (judgement call, recorded in the task report):
-- the brief's draft wrote the override as {"default":..., "overrides":{...}}.
-- That is this app's LEGACY privacy format -- see types/privacy.ts, where it
-- is literally named LegacyPrivacySettings. The live format, and the only one
-- can_view_field() reads, is {"visibleToGroupTypes": [...],
-- "restrictToGroup": <group id>}: restrictToGroup IS the per-group override,
-- and it takes precedence over the group-type list. Using the legacy spelling
-- here would have tested nothing -- can_view_field() would fall through to
-- its "no recognised privacy settings, default to private" branch and return
-- false for everyone, so the stranger assertion would pass for the wrong
-- reason while the member assertion failed against a perfectly correct
-- function. The brief's Step 8.6 requires the function body to carry over
-- unchanged, so the test is written against the format that body reads.
--
-- The last two assertions run the same question through RLS rather than
-- calling the function directly, because a correct function reachable only
-- from a broken policy protects nobody.

create temp table _harness_result (token text);

do $$
declare
  v_group_id  uuid;
  v_can       boolean;
  v_visible   int;
  v_orig_role text;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values ('user_ov_owner', 'ovowner', 'Owner'),
           ('user_ov_peer',  'ovpeer',  'Peer'),
           ('user_ov_stranger', 'ovstranger', 'Stranger');

  insert into groups (name, type, invite_code, created_by)
    values ('Override Group', 'family', 'OVCODE01', 'user_ov_owner')
    returning id into v_group_id;

  insert into group_members (group_id, user_id, role)
    values (v_group_id, 'user_ov_owner', 'owner'),
           (v_group_id, 'user_ov_peer',  'member')
    on conflict do nothing;

  -- Private by default (no group type may see it), but shared with this one
  -- group by id.
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values ('user_ov_owner', 'sizes', 'shoe', '10',
            jsonb_build_object(
              'visibleToGroupTypes', '[]'::jsonb,
              'restrictToGroup', v_group_id::text));

  ---------------------------------------------------------------------------
  -- The function itself.
  ---------------------------------------------------------------------------
  select can_view_field('user_ov_owner', 'user_ov_peer',
    (select privacy_settings from profile_info
      where user_id = 'user_ov_owner' and field_name = 'shoe'))
  into v_can;

  if v_can is not true then
    raise exception 'OVERRIDE FAIL: group member cannot see overridden field';
  end if;
  v_checks := v_checks + 1;

  select can_view_field('user_ov_owner', 'user_ov_stranger',
    (select privacy_settings from profile_info
      where user_id = 'user_ov_owner' and field_name = 'shoe'))
  into v_can;

  if v_can is not false then
    raise exception 'OVERRIDE FAIL: stranger can see overridden field';
  end if;
  v_checks := v_checks + 1;

  select can_view_field('user_ov_owner', 'user_ov_owner',
    (select privacy_settings from profile_info
      where user_id = 'user_ov_owner' and field_name = 'shoe'))
  into v_can;

  if v_can is not true then
    raise exception 'OVERRIDE FAIL: owner cannot see their own field';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The same question through the policy that actually guards the table.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_peer","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from profile_info
    where user_id = 'user_ov_owner' and field_name = 'shoe';

  if v_visible <> 1 then
    raise exception
      'OVERRIDE FAIL: shared-group member reads % overridden field(s) through RLS, expected 1',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_stranger","role":"authenticated"}', true);

  select count(*) into v_visible
    from profile_info
    where user_id = 'user_ov_owner' and field_name = 'shoe';

  if v_visible <> 0 then
    raise exception
      'OVERRIDE FAIL: stranger reads % overridden field(s) through RLS, expected 0',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 5 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 5. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_04_privacy_overrides');
end $$;

select token as result from _harness_result;
