-- 20260912000002_occasion_partner.sql widens "Celebrated occasions follow the
-- underlying date's privacy" with a second branch: a row whose partner_id is
-- set is also visible to a viewer who can see the PARTNER's date, even if
-- they cannot see the celebrant's. This file is the behavioural proof for
-- that widening, on the live policy text -- it does not inspect the policy's
-- SQL at all, the same convention 11_occasion_visibility.sql follows for the
-- branch this one extends.
--
-- THE FIXTURE, AND WHY IT IS SHAPED THIS WAY.
--
-- One shared occasion, celebrant v_celebrant / partner v_partner, each with
-- their own 'anniversary' profile_info row under 'dates', each in a
-- DIFFERENT group (family vs. friends), each with privacy_settings that
-- admit only that one group type. This is deliberate, per the task brief:
-- "two users whose anniversary privacy_settings differ, in different groups,
-- so 'can see one but not the other' is a real state rather than a
-- coincidence of layout." A single viewer who can see v_celebrant's date
-- necessarily cannot see v_partner's (disjoint group membership, disjoint
-- visibleToGroupTypes), and vice versa -- neither half of the OR is
-- satisfiable by accident here.
--
-- A second, UNSHARED occasion (partner_id left null, a different celebrant
-- entirely, privacy_settings excluding every group) stands in for assertion
-- 4: proof that the new OR-branch cannot fire when there is no partner to
-- admit, i.e. that the widening is additive rather than a general loosening.
-- This is the most important assertion in the file -- see the migration's
-- own header for why.
--
-- Four assertions:
--   1. a viewer who can see only the CELEBRANT's date reads the shared row
--      (the policy's pre-existing branch, still intact);
--   2. a viewer who can see only the PARTNER's date reads the SAME shared
--      row -- the whole point of the widening, and the one assertion Step 5
--      proves would fail without the new branch;
--   3. a viewer who can see NEITHER date reads zero rows for the shared
--      occasion -- assertions 1 and 2 already prove the row is readable by
--      somebody, so this measures exclusion specifically;
--   4. that same neither-can-see viewer reads zero rows for the UNSHARED
--      occasion. Its celebrant is unrelated to the shared couple and its
--      privacy_settings admit no group at all, so this is not a coincidence
--      of the fixture -- and because partner_id is null there, the new
--      branch's own guard (`partner_id is not null`) must be what keeps this
--      at zero, not the celebrant branch (which is already proven selective
--      by assertion 3 against the shared row's own celebrant leg).
--
-- This file grows again in Tasks 4 and 5 (materialization, then derivation),
-- appending further assertions and raising v_checks' floor to match. Keep
-- the numbering and structure below easy to extend: add a block, bump
-- v_checks, bump the floor.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; role is toggled back to
-- `authenticated` for each viewer's SELECT and restored to the captured
-- `current_user` before the token insert, as every other file in this suite
-- does.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role       text;
  v_checks          int := 0;
  v_celebrant       text := 'user_shanniv_celeb';
  v_partner         text := 'user_shanniv_partner';
  v_viewer_celeb    text := 'user_shanniv_viewer_c';
  v_viewer_partner  text := 'user_shanniv_viewer_p';
  v_viewer_neither  text := 'user_shanniv_viewer_n';
  v_unshared_celeb  text := 'user_shanniv_unshared';
  v_group_celeb     uuid;
  v_group_partner   uuid;
  v_shared_occasion uuid;
  v_unshared_occasion uuid;
  v_visible         int;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values (v_celebrant,      'shanncelb', 'Shared Anniv Celebrant'),
           (v_partner,        'shannprtn', 'Shared Anniv Partner'),
           (v_viewer_celeb,   'shannvwrc', 'Shared Anniv Viewer Celeb-side'),
           (v_viewer_partner, 'shannvwrp', 'Shared Anniv Viewer Partner-side'),
           (v_viewer_neither, 'shannvwrn', 'Shared Anniv Viewer Neither'),
           (v_unshared_celeb, 'shannunshr', 'Shared Anniv Unshared Celebrant');

  -- Two disjoint groups of different TYPES, so "visible to one, not the
  -- other" follows from the privacy_settings below rather than from any
  -- shared membership.
  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv Family', 'family', 'SHANFAM1', v_celebrant)
    returning id into v_group_celeb;

  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv Friends', 'friends', 'SHANFRN1', v_partner)
    returning id into v_group_partner;

  -- add_group_creator_as_owner() already added v_celebrant/v_partner to their
  -- own groups. v_viewer_celeb joins ONLY the family group; v_viewer_partner
  -- joins ONLY the friends group; v_viewer_neither joins neither.
  insert into group_members (group_id, user_id, role)
    values (v_group_celeb, v_viewer_celeb, 'member')
    on conflict do nothing;

  insert into group_members (group_id, user_id, role)
    values (v_group_partner, v_viewer_partner, 'member')
    on conflict do nothing;

  -- Each half of the couple restricts their anniversary date to their OWN
  -- group's type, and only that type.
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_celebrant, 'dates', 'anniversary', '2020-06-15',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_partner, 'dates', 'anniversary', '2020-06-15',
            '{"visibleToGroupTypes": ["friends"], "restrictToGroup": null}');

  -- The shared occasion: one row, keyed to the canonical celebrant, carrying
  -- the partner. This is what Task 4's materialization will do for real; here
  -- it is written directly as the connecting role, the same shortcut
  -- 11_occasion_visibility.sql takes for celebrant rows.
  insert into occasions (celebrant_id, partner_id, kind, occasion_date)
    values (v_celebrant, v_partner, 'anniversary', '2020-06-15')
    returning id into v_shared_occasion;

  -- The unshared occasion: a different celebrant entirely, partner_id left
  -- NULL, privacy_settings excluding every group type (the same "private"
  -- convention 11_occasion_visibility.sql uses for its own celebrant row).
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_unshared_celeb, 'dates', 'anniversary', '2019-03-10',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_unshared_celeb, 'anniversary', '2019-03-10')
    returning id into v_unshared_occasion;

  ---------------------------------------------------------------------------
  -- Assertion 1: a viewer who can see only the CELEBRANT's date reads the
  -- shared row. The policy's pre-existing branch, still intact.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_viewer_celeb || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from occasions where id = v_shared_occasion;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: celebrant-side viewer % sees % row(s) of the shared anniversary occasion, expected 1',
      v_viewer_celeb, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: a viewer who can see only the PARTNER's date reads the SAME
  -- shared row. This is the whole point of the widening -- the old policy
  -- would have refused this viewer entirely, since celebrant_id points at
  -- v_celebrant, whose date this viewer cannot see.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_viewer_partner || '","role":"authenticated"}', true);

  select count(*) into v_visible
    from occasions where id = v_shared_occasion;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: partner-side viewer % sees % row(s) of the shared anniversary occasion, expected 1 -- the widened branch must admit a viewer who can see only the partner''s date',
      v_viewer_partner, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: a viewer who can see NEITHER date reads zero rows for the
  -- shared occasion. Assertions 1 and 2 already proved the row is readable
  -- by somebody, so this measures exclusion specifically, not an empty
  -- table nobody could read regardless of the policy.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_viewer_neither || '","role":"authenticated"}', true);

  select count(*) into v_visible
    from occasions where id = v_shared_occasion;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: viewer % who can see neither date sees % row(s) of the shared anniversary occasion, expected 0',
      v_viewer_neither, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4 (the important one): the SAME neither-can-see viewer reads
  -- zero rows for the UNSHARED occasion. Its partner_id is null, so the new
  -- OR-branch's own guard (`partner_id is not null`) must be what keeps this
  -- row hidden -- proving the widening is additive and cannot admit anything
  -- the old policy refused for a row with no partner at all.
  ---------------------------------------------------------------------------
  select count(*) into v_visible
    from occasions where id = v_unshared_occasion;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: viewer % sees % row(s) of an UNSHARED anniversary occasion (partner_id null), expected 0 -- the new branch must not admit an unshared row',
      v_viewer_neither, v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connecting role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  if v_checks < 4 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 4', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_20_shared_anniversary_reads');
end $$;

select token as result from _harness_result;
