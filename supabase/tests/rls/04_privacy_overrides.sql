-- Group-scoped privacy overrides must behave as they did before the
-- uuid -> text change of the identity parameters.
--
-- can_view_field() is the most intricate logic in the schema and its two user
-- parameters change type, so it is the likeliest place for a silent
-- regression: a comparison that used to match on uuid equality and now
-- silently never matches would leave every overridden field invisible, and a
-- comparison that stopped filtering at all would make every overridden field
-- world-readable.
--
-- WHY THERE ARE FIVE USERS AND THREE GROUPS
--
-- An earlier version of this file used one shared group and a stranger with no
-- groups at all. That leaves a mutant alive, and it is the product's headline
-- feature: change the override branch from
--
--     if shared_group.group_id = restrict_to_group then return true;
-- to
--     return true;                       -- any shared group will do
--
-- and every assertion still passes, because the only user who was denied was
-- denied for sharing NO group rather than for sharing the WRONG one. That
-- mutant is "a field restricted to the family group leaks to the work group".
--
-- So the cast is built to separate the two reasons a viewer can be denied:
--
--   user_ov_peer      shares group G  -- the group the field is restricted to
--   user_ov_other     shares group H  -- a DIFFERENT group, also of type family
--   user_ov_work      shares group W  -- shared, but of an EXCLUDED type
--   user_ov_stranger  shares nothing
--
-- user_ov_other is what kills the override mutant; user_ov_work is what kills
-- the equivalent mutant in the visibleToGroupTypes branch. Neither could be
-- caught by a stranger who shares nothing.
--
-- can_view_wishlist_item() is a byte-for-byte duplicate of the same logic
-- guarding the wishlist, so it gets the same pair of assertions.
--
-- SHAPE NOTE (judgement call, recorded in the task report):
-- the brief's draft wrote the override as {"default":..., "overrides":{...}}.
-- That is this app's LEGACY privacy format -- see types/privacy.ts, where it
-- is literally named LegacyPrivacySettings. The live format, and the only one
-- can_view_field() reads, is {"visibleToGroupTypes": [...],
-- "restrictToGroup": <group id>}: restrictToGroup IS the per-group override,
-- and it takes precedence over the group-type list.
--
-- CALLER NOTE: can_view_field() and can_view_wishlist_item() pin their viewer
-- to requesting_user_id() unless the caller already bypasses RLS, and that pin
-- fails CLOSED -- an unset caller gets false, not the real answer. So each
-- direct call below sets the claims of the viewer it is asking about, which is
-- exactly the shape the policy path uses. Assertion 9 then checks the pin
-- itself: one user asking the question on another user's behalf must be
-- refused even when the true answer is yes.

create temp table _harness_result (token text);

do $$
declare
  v_group_g   uuid;
  v_group_h   uuid;
  v_group_w   uuid;
  v_shoe      jsonb;
  v_shirt     jsonb;
  v_gift      jsonb;
  v_can       boolean;
  v_visible   int;
  v_orig_role text;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values ('user_ov_owner',    'ovowner',    'Owner'),
           ('user_ov_peer',     'ovpeer',     'Peer'),
           ('user_ov_other',    'ovother',    'Other'),
           ('user_ov_work',     'ovwork',     'Work'),
           ('user_ov_stranger', 'ovstranger', 'Stranger');

  insert into groups (name, type, invite_code, created_by)
    values ('Override Group', 'family', 'OVCODE01', 'user_ov_owner')
    returning id into v_group_g;

  insert into groups (name, type, invite_code, created_by)
    values ('Other Family Group', 'family', 'OVCODE02', 'user_ov_owner')
    returning id into v_group_h;

  insert into groups (name, type, invite_code, created_by)
    values ('Work Group', 'work', 'OVCODE03', 'user_ov_owner')
    returning id into v_group_w;

  -- The creator is added as owner of each group by the on_group_created
  -- trigger, so only the counterparties need inserting here.
  insert into group_members (group_id, user_id, role)
    values (v_group_g, 'user_ov_peer',  'member'),
           (v_group_h, 'user_ov_other', 'member'),
           (v_group_w, 'user_ov_work',  'member')
    on conflict do nothing;

  -- shoe: private by default, overridden to exactly group G.
  v_shoe := jsonb_build_object(
    'visibleToGroupTypes', '[]'::jsonb,
    'restrictToGroup', v_group_g::text);

  -- shirt: no per-group override, visible only through family-type groups.
  v_shirt := jsonb_build_object(
    'visibleToGroupTypes', '["family"]'::jsonb,
    'restrictToGroup', null);

  -- the same override, on the wishlist side.
  v_gift := jsonb_build_object(
    'visibleToGroupTypes', '[]'::jsonb,
    'restrictToGroup', v_group_g::text);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values ('user_ov_owner', 'sizes', 'shoe',  '10', v_shoe),
           ('user_ov_owner', 'sizes', 'shirt', 'L',  v_shirt);

  insert into wishlist_items (user_id, title, privacy_settings)
    values ('user_ov_owner', 'Restricted Gift', v_gift);

  ---------------------------------------------------------------------------
  -- can_view_field: the per-group override branch.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_peer","role":"authenticated"}', true);
  select can_view_field('user_ov_owner', 'user_ov_peer', v_shoe) into v_can;
  if v_can is not true then
    raise exception 'OVERRIDE FAIL: member of the restricted group cannot see the overridden field';
  end if;
  v_checks := v_checks + 1;

  -- Shares a group with the owner, and it is even the same TYPE -- but it is
  -- not the group named in restrictToGroup.
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_other","role":"authenticated"}', true);
  select can_view_field('user_ov_owner', 'user_ov_other', v_shoe) into v_can;
  if v_can is not false then
    raise exception
      'OVERRIDE FAIL: a field restricted to group G is visible to a member of a different group H';
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_stranger","role":"authenticated"}', true);
  select can_view_field('user_ov_owner', 'user_ov_stranger', v_shoe) into v_can;
  if v_can is not false then
    raise exception 'OVERRIDE FAIL: stranger can see overridden field';
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_owner","role":"authenticated"}', true);
  select can_view_field('user_ov_owner', 'user_ov_owner', v_shoe) into v_can;
  if v_can is not true then
    raise exception 'OVERRIDE FAIL: owner cannot see their own field';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- can_view_field: the visibleToGroupTypes branch.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_peer","role":"authenticated"}', true);
  select can_view_field('user_ov_owner', 'user_ov_peer', v_shirt) into v_can;
  if v_can is not true then
    raise exception 'OVERRIDE FAIL: family-visible field hidden from a family-group member';
  end if;
  v_checks := v_checks + 1;

  -- Shares a group, but a work group, and the field is family-only.
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_work","role":"authenticated"}', true);
  select can_view_field('user_ov_owner', 'user_ov_work', v_shirt) into v_can;
  if v_can is not false then
    raise exception
      'OVERRIDE FAIL: family-only field is visible through a shared work group';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- can_view_wishlist_item: same logic, separate copy, same two questions.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_peer","role":"authenticated"}', true);
  select can_view_wishlist_item('user_ov_owner', 'user_ov_peer', v_gift) into v_can;
  if v_can is not true then
    raise exception 'OVERRIDE FAIL: member of the restricted group cannot see the overridden wishlist item';
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_other","role":"authenticated"}', true);
  select can_view_wishlist_item('user_ov_owner', 'user_ov_other', v_gift) into v_can;
  if v_can is not false then
    raise exception
      'OVERRIDE FAIL: a wishlist item restricted to group G is visible to a member of a different group H';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The pin itself. user_ov_stranger asks the question on user_ov_peer's
  -- behalf. The true answer is TRUE (the peer really can see the field), so a
  -- false result here can only come from the caller pin, not from the privacy
  -- logic. Without the pin these functions are a boolean oracle over other
  -- people's group memberships.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_stranger","role":"authenticated"}', true);
  select can_view_field('user_ov_owner', 'user_ov_peer', v_shoe) into v_can;
  if v_can is not false then
    raise exception
      'PIN FAIL: user_ov_stranger got a real answer for user_ov_peer''s viewpoint';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The same questions through the policies that actually guard the table.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_peer","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from profile_info
    where user_id = 'user_ov_owner' and field_name = 'shoe';

  if v_visible <> 1 then
    raise exception
      'OVERRIDE FAIL: member of the restricted group reads % overridden field(s) through RLS, expected 1',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ov_other","role":"authenticated"}', true);

  select count(*) into v_visible
    from profile_info
    where user_id = 'user_ov_owner' and field_name = 'shoe';

  if v_visible <> 0 then
    raise exception
      'OVERRIDE FAIL: member of a different group reads % overridden field(s) through RLS, expected 0',
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

  if v_checks < 12 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 12. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_04_privacy_overrides');
end $$;

select token as result from _harness_result;
