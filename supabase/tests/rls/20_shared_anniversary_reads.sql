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
-- 4: proof that the new OR-branch does not FIRE for a row with no partner.
--
-- WHAT ASSERTION 4 DOES NOT PROVE, stated plainly after review caught this
-- file overclaiming it. Additivity -- "the new branch cannot admit anything
-- the old policy refused" -- is a claim about the policy's BOOLEAN
-- STRUCTURE (`X OR (partner_id is not null AND Y)` can only ever be true
-- more often than `X` alone, never less, for every row regardless of
-- fixture), and no fixture-based assertion can establish that; it can only
-- ever sample individual rows. The `partner_id is not null` guard is not
-- what produces assertion 4's zero, either: when partner_id is NULL,
-- `pi.user_id = occasions.partner_id` is NULL for every profile_info row, so
-- the inner `exists (...)` is already false on its own, before the guard is
-- ever consulted. The guard is belt-and-braces documentation of intent, not
-- a barrier -- a version of the policy with the guard deleted entirely
-- (leaving only the equality join) would pass assertion 4 identically. What
-- assertion 4 actually verifies is narrower and still worth having: that
-- this specific unshared row, in this fixture, is not visible through the
-- new branch -- i.e. that the equality join correctly evaluates to "no
-- match" rather than some other bug making it accidentally true for a null
-- partner_id.
--
-- Six assertions:
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
--      of the fixture -- but, per the note above, the zero comes from the
--      `pi.user_id = occasions.partner_id` join never matching a NULL
--      partner_id, not from the `partner_id is not null` guard, and this
--      assertion does not by itself distinguish those two mechanisms (a
--      local build against six policy variants confirmed both a
--      guard-dropped mutation and a mis-parenthesised mutation still pass
--      this assertion; only a mutation that makes the branch unconditional
--      of the join, e.g. a bare `true`, could fail it, and assertion 3 would
--      independently catch that same mutation on the SHARED row);
--   5-6. structural checks that the two CHECK constraints added by
--      20260912000004_occasion_partner_constraints.sql
--      (occasions_partner_requires_celebrant,
--      occasions_partner_not_self) exist on public.occasions with exactly
--      the expected definitions. A violating insert is not attempted for
--      either -- it would RAISE (a check_violation) and abort this file, the
--      same limitation 15_celebrated_materialization.sql's header documents
--      for a raising denial -- so existence and exact text stand in instead.
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
  v_con_def         text;
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
  -- Assertion 4: the SAME neither-can-see viewer reads zero rows for the
  -- UNSHARED occasion (partner_id null). This proves the new branch does not
  -- FIRE for a row with no partner -- it does NOT prove the branch's guard
  -- is what stops it. With partner_id null, `pi.user_id = occasions.partner_id`
  -- is null for every profile_info row, so the inner `exists (...)` is
  -- already false from the equality join alone, before `partner_id is not
  -- null` is ever consulted; the guard is belt-and-braces, not the
  -- mechanism. Additivity -- that this branch can only ever admit MORE than
  -- the old policy, never less -- follows from the policy's boolean
  -- structure (`X OR (guard AND Y)` dominates `X`), not from this or any
  -- other fixture-based assertion. See the file header for the full note.
  ---------------------------------------------------------------------------
  select count(*) into v_visible
    from occasions where id = v_unshared_occasion;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: viewer % sees % row(s) of an UNSHARED anniversary occasion (partner_id null), expected 0 -- the equality join against a null partner_id must not match',
      v_viewer_neither, v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connecting role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 5: occasions_partner_requires_celebrant exists as a CHECK
  -- constraint on public.occasions with exactly the expected definition.
  -- 20260912000004_occasion_partner_constraints.sql added this so a
  -- group-date row (celebrant_id null) can never carry a partner_id --
  -- closing a gap the INSERT/UPDATE with_check clauses leave open (they pin
  -- kind = 'group_date' but constrain neither partner_id nor celebrant_id).
  -- A violating insert is not attempted here: it would RAISE (a
  -- check_violation) and abort this file, the same limitation
  -- 15_celebrated_materialization.sql's header documents for a raising
  -- denial -- so the constraint's existence and exact text are checked
  -- structurally instead.
  ---------------------------------------------------------------------------
  select pg_get_constraintdef(oid) into v_con_def
    from pg_constraint
   where conrelid = 'public.occasions'::regclass
     and conname = 'occasions_partner_requires_celebrant'
     and contype = 'c';

  if v_con_def is distinct from
     'CHECK (((partner_id IS NULL) OR (celebrant_id IS NOT NULL)))' then
    raise exception
      'GUARD FAIL: occasions_partner_requires_celebrant has definition % (or is missing), expected CHECK (((partner_id IS NULL) OR (celebrant_id IS NOT NULL)))',
      v_con_def;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: occasions_partner_not_self exists as a CHECK constraint
  -- with exactly the expected definition -- independent of assertion 5, and
  -- independently necessary: a row naming someone as their own partner would
  -- be a real data bug once Task 4 starts writing this column for real.
  ---------------------------------------------------------------------------
  select pg_get_constraintdef(oid) into v_con_def
    from pg_constraint
   where conrelid = 'public.occasions'::regclass
     and conname = 'occasions_partner_not_self'
     and contype = 'c';

  if v_con_def is distinct from
     'CHECK (((partner_id IS NULL) OR (partner_id <> celebrant_id)))' then
    raise exception
      'GUARD FAIL: occasions_partner_not_self has definition % (or is missing), expected CHECK (((partner_id IS NULL) OR (partner_id <> celebrant_id)))',
      v_con_def;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 6 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 6', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_20_shared_anniversary_reads');
end $$;

select token as result from _harness_result;
