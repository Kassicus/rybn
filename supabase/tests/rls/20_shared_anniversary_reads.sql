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
-- TASK 4 ADDS ASSERTIONS 7-12, proving get_or_create_celebrated_occasion
-- (live body: 20260912000010_canonical_anniversary_deterministic_order.sql
-- -- 20260912000007_canonical_anniversary.sql introduced the resolution but
-- shipped a self-referencing-partner_id bug, corrected by ...0008, which
-- ...0010 then layers a deterministic ORDER BY onto (round-1 review, M3);
-- every pointer in this file to "the live body" below names ...0010, not
-- ...0007 or ...0008) resolves a linked couple to the one shared row this
-- file's first six
-- assertions already established is readable by both partners:
--
--   7. get_or_create_celebrated_occasion(user_a, 'anniversary') and
--      get_or_create_celebrated_occasion(user_b, 'anniversary') -- called by
--      each partner for themself -- return the SAME uuid. This is the
--      assertion the entire design rests on: it is impossible for two
--      different physical rows to share one id, so this alone proves one
--      row now serves both partners' calls, not merely that two rows happen
--      to look alike.
--   8. that row's celebrant_id is the CANONICAL (lexicographically smaller)
--      partner and its partner_id is the other one -- checked as two
--      SEPARATE conditions so a swap (celebrant_id/partner_id reversed) is
--      visible as its own failure, not hidden behind "some row with the
--      right two ids exists". The direction matters beyond cosmetics: see
--      20260912000010_canonical_anniversary_deterministic_order.sql's header (the
--      live body) for why a mirror row (keyed to the
--      non-canonical partner) would leave unlink_anniversary's own
--      `celebrant_id = v_link.user_a` scoping unable to find it, stranding a
--      stale partner_id after a breakup.
--   9. an UNLINKED user still gets an ordinary row (celebrant_id themself,
--      partner_id NULL) -- proving the resolution added in Task 4 is a
--      no-op for the common case, not a behavior change to unshared
--      anniversaries.
--   10. a linked user's BIRTHDAY (kind <> 'anniversary') is NOT resolved
--      through their anniversary link -- celebrant_id is that user, partner_id
--      NULL -- proving the couple resolution is scoped to kind = 'anniversary'
--      and does not leak into an unrelated kind for the same person.
--
-- ROUND-1 REVIEW ADDS ASSERTIONS 11-12, for two gaps this file's first pass
-- left uncovered:
--
--   11. CRITICAL. A caller who can see only the NON-canonical partner's date
--      (and shares no group at all with the canonical partner) both
--      materializes the shared occasion AND successfully claims an item
--      tagged to it. claim_wishlist_item's own occasion gate
--      (20260911100002_claim_rpcs.sql) checked celebrant_id only, with no
--      partner branch, unlike the occasions SELECT policy Task 2 widened --
--      so a partner-side viewer admitted by that widened policy could SEE
--      the shared occasion and still be refused CLAIMING against it. Latent
--      until this task started canonicalizing a couple's occasion under one
--      row for real. Fixed by 20260912000009_claim_partner_gate.sql, which
--      adds the missing partner branch; this assertion is the regression
--      guard, since the flow it covers (claim a gift for a couple's shared
--      anniversary, from the non-canonical side) had no coverage at all
--      before this round.
--   12. IMPORTANT. A PENDING (not yet confirmed) anniversary link does not
--      merge the two occasions -- the requested partner's occasion still
--      shows partner_id NULL. Consent is the whole point of the confirm
--      step; a resolution that fired on a mere request would let one person
--      unilaterally attach themself to the other's occasion before the
--      other ever agreed. Assertions 7-8 cannot cover this (they use an
--      already-CONFIRMED link and pass unchanged under any widening of the
--      status filter), and v_mat_unlinked has no anniversary_links row of
--      any status, so it cannot exercise "pending is not confirmed" either
--      -- this needed its own fixture.
--
-- WHY THERE IS NO ASSERTION FOR THE MIS-PARENTHESISED POLICY, even though
-- Task 4 is the task that was supposed to make one constructible.
--
-- Task 2's reviewer proved, on a local Postgres, that assertion 4 above
-- passes identically whether the occasions SELECT policy reads (as shipped)
--   celebrant_id is not null and (E1 or (partner_id is not null and E2))
-- or the mis-parenthesised
--   (celebrant_id is not null and E1) or (partner_id is not null and E2)
-- (E1/E2 the celebrant/partner visibility subqueries) -- because with
-- partner_id NULL, E2's join can never match, so both forms evaluate to the
-- same false regardless of which one is actually live. Algebraically the two
-- forms differ ONLY when celebrant_id IS NULL: the shipped form is forced to
-- false by its leading conjunct regardless of the OR, while the
-- mis-parenthesised form collapses to `partner_id is not null and E2` and can
-- still evaluate true. So the one row that would tell them apart needs
-- celebrant_id NULL and partner_id NOT NULL, with E2 satisfied.
--
-- That row is not constructible, and this is a change from Task 2's world,
-- not merely an unexploited gap. celebrated_shape forces celebrant_id NOT
-- NULL for every kind except group_date, and group_date_shape forces
-- celebrant_id NULL specifically for a group_date row -- so celebrant_id NULL
-- happens only on a group_date row. 20260912000004_occasion_partner_
-- constraints.sql's occasions_partner_requires_celebrant then forbids
-- exactly the combination needed: `partner_id is null or celebrant_id is not
-- null` rules out partner_id NOT NULL on any row where celebrant_id IS NULL,
-- group_date included. There is therefore no `kind`, constraint-satisfying
-- row shape left with celebrant_id NULL and partner_id NOT NULL -- not "we
-- did not find one", but a closed case: every row admitted by the current
-- schema has celebrant_id NOT NULL whenever partner_id IS NOT NULL, which
-- means `celebrant_id is not null` is true whenever the mis-parenthesised
-- form's second disjunct could matter, which makes the two forms provably
-- equal on every row the schema can hold -- not merely on every row this
-- fixture happens to build. Attempting the row anyway would RAISE a
-- check_violation and abort this file's batch, the same limitation this
-- file's assertions 5-6 and 15_celebrated_materialization.sql's header both
-- document for a raising denial -- so it could not be added as a passing
-- assertion even if the state were desired. The honest outcome, per Task 4's
-- brief, is to say so here and add nothing: a test asserting an
-- unconstructible state would either never run (if written correctly, it
-- would fail every insert attempt) or silently assert something else.
--
-- This file grows again in Task 5 (derivation), appending further
-- assertions and raising v_checks' floor to match. Keep the numbering and
-- structure below easy to extend: add a block, bump v_checks, bump the
-- floor.
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

  -- Task 4: materialization resolution fixtures (assertions 7-10).
  v_mat_a           text := 'user_shanniv_mat_a';
  v_mat_b           text := 'user_shanniv_mat_b';
  v_mat_unlinked    text := 'user_shanniv_mat_unlinked';
  v_mat_link        uuid;
  v_mat_id_from_a   uuid;
  v_mat_id_from_b   uuid;
  v_mat_unlinked_id uuid;
  v_mat_bday_id     uuid;
  v_mat_row_celebrant text;
  v_mat_row_partner   text;

  -- Round-1 review, assertion 11 (CRITICAL): partner-side claim.
  v_pc_canon      text := 'user_shanniv_pc_canon';   -- canonical, family-only anniversary
  v_pc_noncanon   text := 'user_shanniv_pc_noncanon'; -- non-canonical, friends-only anniversary, item owner
  v_pc_gifter     text := 'user_shanniv_pc_gifter';   -- friends group only, shares nothing with v_pc_canon
  v_pc_group_family uuid;
  v_pc_group_friends uuid;
  v_pc_occasion   uuid;
  v_pc_item       uuid;
  v_pc_claim      uuid;
  v_pc_active_claims int;

  -- Round-1 review, assertion 12 (IMPORTANT): a PENDING link must not merge.
  v_pend_a        text := 'user_shanniv_pend_a';
  v_pend_b        text := 'user_shanniv_pend_b';
  v_pend_b_occasion uuid;
  v_pend_row_celebrant text;
  v_pend_row_partner   text;
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
  -- Task 4 fixtures (assertions 7-10): v_mat_a/v_mat_b are a CONFIRMED
  -- anniversary couple (v_mat_a lexicographically smaller, so it is the
  -- canonical user_a the CHECK constraint requires); v_mat_unlinked has an
  -- anniversary on file but no link at all. Each of the three also gets its
  -- own 'anniversary' profile_info row so each can call get_or_create_
  -- celebrated_occasion FOR THEMSELF (owner-views-self short-circuits
  -- can_view_field to true regardless of privacy_settings, so the exact
  -- group shape does not matter here -- unlike the visibility fixture
  -- above, this block is proving what get_or_create_celebrated_occasion
  -- WRITES, not who can read it back). v_mat_a additionally gets a
  -- 'birthday' row for assertion 10, proving the couple resolution does not
  -- leak into a kind it was never meant to touch.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_mat_a,        'shanmatcpla', 'Shared Anniv Mat Celeb A'),
           (v_mat_b,        'shanmatcplb', 'Shared Anniv Mat Celeb B'),
           (v_mat_unlinked, 'shanmatunlk', 'Shared Anniv Mat Unlinked');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values
      (v_mat_a, 'dates', 'anniversary', '2020-06-15',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}'),
      (v_mat_b, 'dates', 'anniversary', '2020-06-15',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}'),
      (v_mat_unlinked, 'dates', 'anniversary', '2021-07-04',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}'),
      (v_mat_a, 'dates', 'birthday', '1990-01-01',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_mat_a, v_mat_b, 'confirmed', v_mat_a, '2020-06-15', now())
    returning id into v_mat_link;

  insert into anniversary_link_members (user_id, link_id)
    values (v_mat_a, v_mat_link), (v_mat_b, v_mat_link);

  ---------------------------------------------------------------------------
  -- Round-1 review, assertion 11 fixture (CRITICAL): a confirmed couple
  -- whose anniversary privacy DIFFERS by group (same shape as the six-
  -- assertion fixture above, so "can see one but not the other" is real),
  -- plus a gifter who shares a group with the NON-canonical partner (and
  -- thus owns the item, since can_view_wishlist_item requires a group
  -- shared with the ITEM'S OWNER) but shares NOTHING with the canonical
  -- celebrant. This is the reviewer's exact reproduction shape.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_pc_canon,    'shanpccanon', 'Shared Anniv PC Canon'),
           (v_pc_noncanon, 'shanpcnoncanon', 'Shared Anniv PC Non-canon'),
           (v_pc_gifter,   'shanpcgifter', 'Shared Anniv PC Gifter');

  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv PC Family', 'family', 'SHANPCF1', v_pc_canon)
    returning id into v_pc_group_family;

  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv PC Friends', 'friends', 'SHANPCFR', v_pc_noncanon)
    returning id into v_pc_group_friends;

  -- v_pc_gifter joins ONLY the friends group (created by, and shared with,
  -- the NON-canonical partner). v_pc_canon has no group in common with
  -- v_pc_gifter at all.
  insert into group_members (group_id, user_id, role)
    values (v_pc_group_friends, v_pc_gifter, 'member') on conflict do nothing;

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values
      (v_pc_canon, 'dates', 'anniversary', '2020-06-15',
       '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'),
      (v_pc_noncanon, 'dates', 'anniversary', '2020-06-15',
       '{"visibleToGroupTypes": ["friends"], "restrictToGroup": null}');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_pc_canon, v_pc_noncanon, 'confirmed', v_pc_canon, '2020-06-15', now());

  -- The item belongs to the NON-canonical partner -- can_view_wishlist_item
  -- requires a group shared with the item's OWNER, so this is what lets the
  -- gifter see the item at all.
  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_pc_noncanon, 'Shared Anniv PC Item',
            '{"visibleToGroupTypes": ["friends"], "restrictToGroup": null}')
    returning id into v_pc_item;

  ---------------------------------------------------------------------------
  -- Round-1 review, assertion 12 fixture (IMPORTANT): a PENDING (not yet
  -- confirmed) anniversary link. v_pend_b is the recipient who has not
  -- accepted -- calling for them must NOT resolve onto v_pend_a's occasion.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_pend_a, 'shanpenda', 'Shared Anniv Pending A'),
           (v_pend_b, 'shanpendb', 'Shared Anniv Pending B');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values
      (v_pend_a, 'dates', 'anniversary', '2022-08-08',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}'),
      (v_pend_b, 'dates', 'anniversary', '2022-08-08',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_pend_a, v_pend_b, 'pending', v_pend_a, '2022-08-08');

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

  ---------------------------------------------------------------------------
  -- Assertion 7: get_or_create_celebrated_occasion(v_mat_a, 'anniversary')
  -- and get_or_create_celebrated_occasion(v_mat_b, 'anniversary') -- called
  -- by each partner FOR THEMSELF -- return the SAME uuid. Two different rows
  -- cannot share one id, so this alone proves one occasion now serves both
  -- partners' calls.
  --
  -- FALSIFIABLE: deleting the `if p_kind = 'anniversary' then ... end if;`
  -- resolution block in 20260912000010_canonical_anniversary_deterministic_order.sql
  -- (the live body -- so the function always materializes under
  -- p_celebrant_id, the pre-Task-4 behaviour) makes this fail -- verified by
  -- mutation against a scratch copy, see the task report. NOT caught: a
  -- resolution that fires but picks the WRONG canonical id consistently for
  -- both calls (assertion 8 catches that).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_mat_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.get_or_create_celebrated_occasion(v_mat_a, 'anniversary')
    into v_mat_id_from_a;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_mat_b || '","role":"authenticated"}', true);

  select public.get_or_create_celebrated_occasion(v_mat_b, 'anniversary')
    into v_mat_id_from_b;

  if v_mat_id_from_a is distinct from v_mat_id_from_b then
    raise exception
      'RLS FAIL: get_or_create_celebrated_occasion(%, anniversary) returned % but get_or_create_celebrated_occasion(%, anniversary) returned % -- a confirmed couple must resolve to the SAME occasion row',
      v_mat_a, v_mat_id_from_a, v_mat_b, v_mat_id_from_b;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8 (2 checks): the shared row's celebrant_id is the CANONICAL
  -- (lexicographically smaller) partner and its partner_id is the other one
  -- -- checked as two SEPARATE conditions so a swap is its own visible
  -- failure, not folded into "some row with the right two ids exists".
  --
  -- FALSIFIABLE: reversing the live body's
  -- (20260912000010_canonical_anniversary_deterministic_order.sql) assignment
  -- (storing under the NON-canonical id, with the canonical one as
  -- partner_id) makes
  -- BOTH of these fail -- verified by mutation against a scratch copy, see
  -- the task report, which also traces the consequence for
  -- unlink_anniversary a reversed direction would cause. NOT caught: a
  -- resolution that picks the right two ids but for the wrong REASON (e.g.
  -- hardcoding this fixture's literal ids) -- out of scope for a
  -- black-box RLS assertion.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_mat_a || '","role":"authenticated"}', true);

  select celebrant_id, partner_id into v_mat_row_celebrant, v_mat_row_partner
    from public.occasions where id = v_mat_id_from_a;

  if v_mat_row_celebrant is distinct from v_mat_a then
    raise exception
      'RLS FAIL: shared anniversary occasion has celebrant_id=%, expected the CANONICAL (lexicographically smaller) partner % -- a mirror row keyed to the non-canonical partner would leave unlink_anniversary unable to find it (see 20260912000010_canonical_anniversary_deterministic_order.sql''s header, the live body)',
      v_mat_row_celebrant, v_mat_a;
  end if;
  v_checks := v_checks + 1;

  if v_mat_row_partner is distinct from v_mat_b then
    raise exception
      'RLS FAIL: shared anniversary occasion has partner_id=%, expected the non-canonical partner %',
      v_mat_row_partner, v_mat_b;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: an UNLINKED user still gets an ordinary row -- celebrant_id
  -- themself, partner_id NULL -- proving Task 4's resolution is a no-op for
  -- the common case rather than a behaviour change to unshared anniversaries.
  --
  -- FALSIFIABLE: removing the `if v_target is null then v_target :=
  -- p_celebrant_id; v_partner := null; end if;` reset (so a celebrant with
  -- no confirmed link keeps the NULLs the failed SELECT INTO leaves behind)
  -- makes this fail with a NOT-NULL/check violation on the insert instead of
  -- a clean row -- verified by mutation against a scratch copy, see the task
  -- report. NOT caught: a resolution that correctly no-ops here but is wired
  -- to the wrong link status filter (assertion 7/8 would catch a status
  -- filter broad enough to also match this user, since v_mat_unlinked has no
  -- anniversary_links row of any status at all).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_mat_unlinked || '","role":"authenticated"}', true);

  select public.get_or_create_celebrated_occasion(v_mat_unlinked, 'anniversary')
    into v_mat_unlinked_id;

  select celebrant_id, partner_id into v_mat_row_celebrant, v_mat_row_partner
    from public.occasions where id = v_mat_unlinked_id;

  if v_mat_row_celebrant is distinct from v_mat_unlinked or v_mat_row_partner is not null then
    raise exception
      'RLS FAIL: unlinked user %''s anniversary occasion has celebrant_id=%, partner_id=%, expected celebrant_id=% and partner_id NULL -- the couple resolution must not fire for a user with no confirmed link',
      v_mat_unlinked, v_mat_row_celebrant, v_mat_row_partner, v_mat_unlinked;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: v_mat_a's BIRTHDAY -- a kind other than 'anniversary', for
  -- a user who IS in a confirmed anniversary link -- is NOT resolved through
  -- that link: celebrant_id is v_mat_a, partner_id NULL. Proves the
  -- resolution is scoped to kind = 'anniversary' and does not leak into an
  -- unrelated kind for the same person.
  --
  -- FALSIFIABLE: widening the live body's
  -- (20260912000010_canonical_anniversary_deterministic_order.sql) `if p_kind =
  -- 'anniversary' then` guard to run unconditionally (for every kind) makes
  -- this fail -- v_mat_a has a confirmed anniversary link, so the birthday
  -- row would pick up partner_id = v_mat_b -- verified by mutation against a
  -- scratch copy, see the task report. NOT caught: a leak that only affects
  -- a kind neither this file nor 15_celebrated_materialization.sql exercises
  -- (there are only two celebrated kinds, birthday and anniversary, so none
  -- exists today).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_mat_a || '","role":"authenticated"}', true);

  select public.get_or_create_celebrated_occasion(v_mat_a, 'birthday')
    into v_mat_bday_id;

  select celebrant_id, partner_id into v_mat_row_celebrant, v_mat_row_partner
    from public.occasions where id = v_mat_bday_id;

  if v_mat_row_celebrant is distinct from v_mat_a or v_mat_row_partner is not null then
    raise exception
      'RLS FAIL: birthday occasion for % (who IS in a confirmed anniversary link) has celebrant_id=%, partner_id=%, expected celebrant_id=% and partner_id NULL -- the couple resolution must be scoped to kind=anniversary, not leak into birthdays',
      v_mat_a, v_mat_row_celebrant, v_mat_row_partner, v_mat_a;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11 (CRITICAL, round-1 review, 2 checks): a viewer who shares
  -- NO group with the canonical celebrant, but shares a group with (and
  -- therefore owns the item belonging to) the NON-canonical partner, both
  -- materializes the shared occasion and successfully CLAIMS against it.
  --
  -- FALSIFIABLE: removing the partner `union all` arm from claim_wishlist_
  -- item's occasion gate (reverting to the pre-round-1 body,
  -- 20260911100002_claim_rpcs.sql, celebrant-and-group-date arms only)
  -- makes the claim call below RAISE 'that occasion is not available' --
  -- verified by mutation against a scratch copy, see the task report. NOT
  -- caught: a claim gate that admits every occasion unconditionally (out of
  -- scope -- 16_claim_visibility.sql and 17_claim_lifecycle.sql cover the
  -- celebrant and group_date arms' own necessity).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_pc_noncanon || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.get_or_create_celebrated_occasion(v_pc_noncanon, 'anniversary')
    into v_pc_occasion;

  perform set_config('role', v_orig_role, true);

  insert into wishlist_item_occasions (item_id, occasion_id)
    values (v_pc_item, v_pc_occasion);

  if v_pc_occasion is null then
    raise exception
      'RLS FAIL: materializing the shared anniversary occasion from the non-canonical partner % returned NULL',
      v_pc_noncanon;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_pc_gifter || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.claim_wishlist_item(v_pc_item, v_pc_occasion) into v_pc_claim;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_pc_active_claims
    from wishlist_claims
   where item_id = v_pc_item and claimed_by = v_pc_gifter and released_at is null;

  if v_pc_claim is null or v_pc_active_claims <> 1 then
    raise exception
      'RLS FAIL: partner-side gifter % claiming item % against shared occasion % returned claim_id=% with % active claim row(s) on file, expected a non-null id and exactly 1 -- the claim gate''s partner branch must admit a viewer who can see only the partner''s date',
      v_pc_gifter, v_pc_item, v_pc_occasion, v_pc_claim, v_pc_active_claims;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12 (IMPORTANT, round-1 review, 1 check): a PENDING anniversary
  -- link must not merge the two occasions. Calling for the RECIPIENT (who
  -- has not confirmed) must still return a row with partner_id NULL.
  --
  -- FALSIFIABLE: widening the resolution's `where l.status = 'confirmed'`
  -- to `where l.status in ('confirmed', 'pending')` makes this fail --
  -- v_pend_b would resolve onto v_pend_a's occasion before ever accepting
  -- the request -- verified by mutation against a scratch copy, see the
  -- task report. NOT caught by assertions 7/8 (both use an already-
  -- CONFIRMED link and pass unchanged under this widening) or by assertion
  -- 9 (v_mat_unlinked has no anniversary_links row of any status, so it
  -- cannot exercise "pending is not confirmed" either).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_pend_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.get_or_create_celebrated_occasion(v_pend_b, 'anniversary')
    into v_pend_b_occasion;

  select celebrant_id, partner_id into v_pend_row_celebrant, v_pend_row_partner
    from public.occasions where id = v_pend_b_occasion;

  if v_pend_row_celebrant is distinct from v_pend_b or v_pend_row_partner is not null then
    raise exception
      'RLS FAIL: recipient % of a still-PENDING anniversary link has celebrant_id=%, partner_id=%, expected celebrant_id=% and partner_id NULL -- a pending (not yet confirmed) link must not merge the two occasions',
      v_pend_b, v_pend_row_celebrant, v_pend_row_partner, v_pend_b;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 14 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 14', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_20_shared_anniversary_reads');
end $$;

select token as result from _harness_result;
