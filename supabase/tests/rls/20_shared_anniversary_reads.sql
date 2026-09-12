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
-- TASK 5 ADDS ASSERTIONS 13-16, on get_upcoming_occasions() (live body:
-- 20260912000011_derivation_partner.sql), proving the DERIVED listing
-- collapses a confirmed couple's anniversary into ONE row PER VIEWER -- not
-- globally. Task 4's assertions above prove the MATERIALIZED occasion is one
-- row; these prove the read-time derivation (which never touches the
-- occasions table unless a row already exists there) agrees.
--
-- Fixture: v_up_a / v_up_b, a confirmed couple whose anniversary privacy
-- DIFFERS by group -- same shape as the six-assertion fixture at the top of
-- this file, so "can see one but not the other" is a real state. Four
-- viewers: one in both groups, one in each group alone, and one in neither.
-- A fifth, unrelated, UNLINKED user stands in for the "no link" baseline.
-- Dates are pinned to a fixed calendar anchor ('1999-11-29'), not an offset
-- from current_date, and every call below passes p_days_ahead => 400 (not
-- the default 30) specifically so that ANY fixed month-day falls inside the
-- window regardless of what day this suite happens to run -- the same
-- technique 12_occasion_derivation.sql's own rollover assertion (assertion
-- 6) uses, for the same reason.
--
--   13. v_up_viewer_both (in BOTH groups, sees both dates) gets exactly ONE
--       anniversary row for the couple, keyed to the canonical partner
--       (v_up_a), with BOTH partner columns populated (partner_id = v_up_b,
--       partner_username/partner_display_name matching v_up_b's profile).
--   14. CRITICAL, both directions. v_up_viewer_a (in v_up_a's group only)
--       gets exactly ONE row -- v_up_a's own individual row, NOT the merged
--       row -- with partner_id NULL. v_up_viewer_b (in v_up_b's group only)
--       is the symmetric case: exactly one row for v_up_b, partner_id NULL.
--       This is the one assertion a GLOBAL merge (collapsing whenever a
--       confirmed link exists, rather than whenever THIS VIEWER can see
--       both dates) fails while passing 13, 15 and 16 -- verified by
--       mutation against a scratch copy of the function with the per-viewer
--       can_view_field(partner) gate removed from the exclusion, see the
--       task report. A viewer who can see only one partner's date must
--       neither lose that person's row (zero) nor receive the row merged
--       with data they cannot see.
--   15. v_up_viewer_neither (in neither group) gets ZERO rows for the
--       couple.
--   16. An unrelated, UNLINKED user with their own anniversary on file is
--       unaffected: their self-view still gets exactly one row, celebrant_id
--       themself, partner_id NULL -- proving the exclusion only ever fires
--       for someone actually party to a confirmed link.
--
-- ROUND-1 REVIEW ADDS ASSERTION 17, for a SECOND failure mode assertions
-- 13-16 did not cover: the WINDOW axis, not the visibility axis.
-- get_upcoming_occasions' couple arm requires its own date -- derived
-- SOLELY from the link's CANONICAL (user_a) partner's profile_info row -- to
-- be non-null and within p_days_ahead. 20260912000011_derivation_partner.sql
-- originally shipped the per-person exclusion checking visibility only, with
-- no equivalent window check, so a confirmed, mutually-visible couple whose
-- canonical partner's date fell outside the window but whose OTHER
-- partner's fell inside it could reach a state where NEITHER arm emits: the
-- exclusion still removed the in-window partner's individual row (visibility
-- was satisfied), and the couple arm still declined (its own window check on
-- the canonical partner's date failed). Reproduced end-to-end through the
-- real request_anniversary_link/confirm_anniversary_link RPCs -- see the
-- task report -- and fixed at the root (confirm_anniversary_link now
-- reconciles BOTH partners' dates, 20260912000012) and at the guard
-- (the exclusion now carries the couple arm's own non-null-and-in-window
-- predicate, 20260912000013, now the live body of this function).
--
--   17. A confirmed couple whose CANONICAL partner's date is OUTSIDE a
--       bounded window and whose NON-canonical partner's is INSIDE it, for a
--       viewer who can see both, gets exactly ONE row -- the in-window
--       partner's own, unmerged, partner_id NULL. Uses offsets from
--       current_date rather than a fixed calendar anchor, deliberately: the
--       scenario IS the date's position relative to the window, so a fixed
--       anchor plus a wide p_days_ahead (this file's own assertions 13-16)
--       would never be able to construct it. See the fixture's own comment
--       for why the specific offsets chosen need no "does not run in the
--       last/first N days of the year" caveat, unlike a fixture that instead
--       tests the rollover branch by going backward from current_date.
--
-- THE FINAL WHOLE-BRANCH REVIEW ADDS ASSERTIONS 18-21, for the two findings
-- everything above missed because everything above exercised only
-- get_or_create_celebrated_occasion.
--
--   18. FINDING I1, and the SPEC'S OWN "done when" #3, which nothing in this
--       repository asserted before: tagging from EITHER partner's list and
--       claiming from EITHER land on the same occasion id, and the couple
--       has exactly ONE anniversary occasion row afterwards.
--       lib/actions/item-occasions.ts tags through get_or_create_occasion,
--       not get_or_create_celebrated_occasion -- a fact
--       lib/occasions/taggable.ts documents and the design document
--       (:205-209) denied -- and that function had no couple resolution at
--       all until 20260912000015. A couple who tagged before claiming got
--       two rows. The tagging call from the NON-canonical side runs FIRST
--       here, because that is the call that used to create the stray row.
--   19. FINDING I1: that single row is keyed to the canonical partner with
--       the other in partner_id. Not redundant with assertion 8 -- the row
--       here is created by get_or_create_occasion, a separate body carrying
--       its own copy of the resolution, and a mirror row from either
--       function strands a stale partner_id past unlink.
--   20. FINDING I4: the shared row's occasion_date comes from the CANONICAL
--       partner regardless of who materialized it last. Both functions used
--       to derive from the celebrant the caller NAMED and then upsert under
--       the canonical id with `do update set occasion_date = excluded.
--       occasion_date`, making the date last-writer-wins by whoever clicked
--       -- which reaches claim auto-release
--       (20260911100002_claim_rpcs.sql frees a claim once
--       `occasion_date < current_date`), not merely the label. The fixture's
--       two profile dates DIFFER, without which this assertion would be
--       vacuous.
--   21. FINDING I4, lifecycle half: a claim already scoped to a couple's
--       shared occasion survives the other partner materializing afterwards.
--       Reuses assertion 11's fixture, the only one in this file holding a
--       real claim.
--
-- Assertions 18-21 use FIXED calendar anchors and compare month/day only, so
-- the this-year-or-next rollover celebration_date_in_year() applies cannot
-- make them calendar-dependent.
--
-- Keep the numbering and structure below easy to extend: add a block, bump
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

  -- Final whole-branch review, assertions 18-21 (findings I1 and I4): the
  -- TAGGING path (get_or_create_occasion) and the CLAIMING path
  -- (get_or_create_celebrated_occasion) must land on ONE occasion, carrying
  -- the CANONICAL partner's date. Deliberately different profile dates, so
  -- "whose date won" is observable.
  v_tg_a          text := 'user_shanniv_tg_a';   -- canonical (smaller id)
  v_tg_b          text := 'user_shanniv_tg_b';   -- non-canonical
  v_tg_link       uuid;
  v_tg_tag_b      uuid;   -- tagging, from the non-canonical partner's list
  v_tg_tag_a      uuid;   -- tagging, from the canonical partner's list
  v_tg_claim_b    uuid;   -- claiming, naming the non-canonical partner
  v_tg_claim_a    uuid;   -- claiming, naming the canonical partner
  v_tg_rows       int;
  v_tg_celebrant  text;
  v_tg_partner    text;
  v_tg_monthday   text;
  -- Read at the TAG-ONLY checkpoint (assertion 18c/18d), before either
  -- get_or_create_celebrated_occasion call can overwrite these two columns.
  v_tg_tag_celebrant text;
  v_tg_tag_partner   text;

  -- Round-1 review, assertion 12 (IMPORTANT): a PENDING link must not merge.
  v_pend_a        text := 'user_shanniv_pend_a';
  v_pend_b        text := 'user_shanniv_pend_b';
  v_pend_b_occasion uuid;
  v_pend_row_celebrant text;
  v_pend_row_partner   text;

  -- Task 5 fixtures (assertions 13-16): get_upcoming_occasions()'s per-viewer
  -- collapse. v_up_a/v_up_b are a confirmed couple whose anniversary privacy
  -- differs by group, exactly like the six-assertion fixture at the top of
  -- this file. v_up_viewer_both/_a/_b/_neither are four distinct viewers;
  -- v_up_unlinked stands in for the "no link at all" baseline.
  v_up_a             text := 'user_shanniv_up_a';
  v_up_b             text := 'user_shanniv_up_b';
  v_up_viewer_both   text := 'user_shanniv_up_vboth';
  v_up_viewer_a      text := 'user_shanniv_up_va';
  v_up_viewer_b      text := 'user_shanniv_up_vb';
  v_up_viewer_neither text := 'user_shanniv_up_vn';
  v_up_unlinked      text := 'user_shanniv_up_unlk';
  v_up_group_a       uuid;
  v_up_group_b       uuid;
  v_up_count         int;
  v_up_celebrant     text;
  v_up_partner       text;
  v_up_partner_uname text;
  v_up_partner_dname text;

  -- Round-1 review, assertion 17 (CRITICAL regression guard, window axis):
  -- a confirmed couple whose CANONICAL (user_a) date is well OUTSIDE a
  -- bounded window and whose NON-canonical (user_b) date is well INSIDE it,
  -- for a viewer who can see both. Offsets from current_date are used
  -- deliberately here (not a fixed calendar anchor): the entire point of
  -- this fixture is the date's position RELATIVE to the query window, the
  -- same technique 12_occasion_derivation.sql's own assertion 6 (year
  -- rollover) uses for the same reason. Both offsets (+100, +5) are
  -- comfortably clear of any year-boundary edge case: get_upcoming_
  -- occasions' own rollover logic always resolves a month-day derived from
  -- (current_date + N), 0 < N < 366, to exactly current_date + N, regardless
  -- of which calendar year that falls in -- there is no "does not run in the
  -- last/first N days of the year" caveat needed here, unlike a fixture that
  -- tests the rollover branch itself by going BACKWARD from current_date.
  v_wg_a          text := 'user_shanniv_wg_a';
  v_wg_b          text := 'user_shanniv_wg_b';
  v_wg_viewer     text := 'user_shanniv_wg_viewer';
  v_wg_group_a    uuid;
  v_wg_group_b    uuid;
  v_wg_count      int;
  v_wg_celebrant  text;
  v_wg_partner    text;
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
  -- Final whole-branch review fixture (assertions 18-21, findings I1 + I4):
  -- a second CONFIRMED couple, distinct from v_mat_a/v_mat_b so the
  -- call ORDER below can start from a clean slate -- assertion 7 has already
  -- materialized the v_mat couple's row by the time these run.
  --
  -- The two profile dates DIFFER on purpose, and are FIXED calendar anchors
  -- rather than offsets from current_date: every assertion below compares
  -- month/day only (to_char(..., 'MM-DD')), so the year
  -- celebration_date_in_year() rolls to is irrelevant and this fixture is
  -- safe on every day of the year. Without differing dates, finding I4's
  -- assertion would be vacuous -- both partners' derivations would agree by
  -- coincidence and no ordering of the calls could tell them apart.
  --
  -- Neither partner needs a group or permissive privacy: every call below is
  -- made BY one of the two partners FOR themself, and can_view_field
  -- short-circuits to true for an owner viewing their own field.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_tg_a, 'shantgcpla', 'Shared Anniv Tag Couple A'),
           (v_tg_b, 'shantgcplb', 'Shared Anniv Tag Couple B');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values
      (v_tg_a, 'dates', 'anniversary', '2020-03-04',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}'),
      (v_tg_b, 'dates', 'anniversary', '2020-09-14',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_tg_a, v_tg_b, 'confirmed', v_tg_a, '2020-03-04', now())
    returning id into v_tg_link;

  insert into anniversary_link_members (user_id, link_id)
    values (v_tg_a, v_tg_link), (v_tg_b, v_tg_link);

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
  -- Task 5 fixture (assertions 13-16): get_upcoming_occasions()'s per-viewer
  -- collapse. v_up_a/v_up_b are a CONFIRMED couple whose anniversary privacy
  -- DIFFERS by group -- same shape as the six-assertion fixture above, so
  -- "can see one but not the other" is a real state, not a coincidence of
  -- layout. Four viewers: both groups, family-only, friends-only, neither.
  -- v_up_unlinked is unrelated to this couple entirely and carries no
  -- anniversary_links row of any kind -- the "no link" baseline.
  --
  -- The date is pinned to a fixed calendar anchor, not an offset from
  -- current_date; every call against this fixture below passes
  -- p_days_ahead => 400 specifically so that fixed anchor falls inside the
  -- window regardless of what day this suite runs (same technique
  -- 12_occasion_derivation.sql's own rollover assertion uses).
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_up_a,              'shanupa',    'Shared Anniv UP A'),
           (v_up_b,              'shanupb',    'Shared Anniv UP B'),
           (v_up_viewer_both,    'shanupvboth','Shared Anniv UP Viewer Both'),
           (v_up_viewer_a,       'shanupva',   'Shared Anniv UP Viewer A'),
           (v_up_viewer_b,       'shanupvb',   'Shared Anniv UP Viewer B'),
           (v_up_viewer_neither, 'shanupvn',   'Shared Anniv UP Viewer Neither'),
           (v_up_unlinked,       'shanupunlk', 'Shared Anniv UP Unlinked');

  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv UP Family', 'family', 'SHANUPFAM', v_up_a)
    returning id into v_up_group_a;

  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv UP Friends', 'friends', 'SHANUPFRD', v_up_b)
    returning id into v_up_group_b;

  -- add_group_creator_as_owner() already added v_up_a/v_up_b to their own
  -- groups. v_up_viewer_both joins BOTH; v_up_viewer_a/_b join only their
  -- namesake's group; v_up_viewer_neither joins neither.
  insert into group_members (group_id, user_id, role)
    values (v_up_group_a, v_up_viewer_both, 'member'),
           (v_up_group_a, v_up_viewer_a,    'member'),
           (v_up_group_b, v_up_viewer_both, 'member'),
           (v_up_group_b, v_up_viewer_b,    'member')
    on conflict do nothing;

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_up_a, 'dates', 'anniversary', '1999-11-29',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'),
           (v_up_b, 'dates', 'anniversary', '1999-11-29',
            '{"visibleToGroupTypes": ["friends"], "restrictToGroup": null}'),
           (v_up_unlinked, 'dates', 'anniversary', '2003-05-17',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_up_a, v_up_b, 'confirmed', v_up_a, '1999-11-29', now());

  ---------------------------------------------------------------------------
  -- Round-1 review fixture (assertion 17, CRITICAL, window axis): a
  -- confirmed couple whose CANONICAL (v_wg_a) date is well OUTSIDE a bounded
  -- 30-day window and whose NON-canonical (v_wg_b) date is well INSIDE it,
  -- for a viewer who can see both dates (two groups, one each, same shape as
  -- the six-assertion fixture at the top of this file). This is the
  -- reviewer's exact reproduction: the exclusion in
  -- 20260912000011_derivation_partner.sql originally checked visibility
  -- only, with no window check of its own, so it could suppress v_wg_b's
  -- individual row even though the couple arm (gated on v_wg_a's own date
  -- being in-window) declines to fire -- neither arm emits, and a
  -- genuinely-visible, genuinely-upcoming anniversary silently disappears.
  -- Fixed by 20260912000013_derivation_window_guard.sql (live body).
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_wg_a,      'shanwga',   'Shared Anniv WG A'),
           (v_wg_b,      'shanwgb',   'Shared Anniv WG B'),
           (v_wg_viewer, 'shanwgv',   'Shared Anniv WG Viewer');

  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv WG A', 'family', 'SHANWGA1', v_wg_a)
    returning id into v_wg_group_a;

  insert into groups (name, type, invite_code, created_by)
    values ('Shanniv WG B', 'friends', 'SHANWGB1', v_wg_b)
    returning id into v_wg_group_b;

  insert into group_members (group_id, user_id, role)
    values (v_wg_group_a, v_wg_viewer, 'member'),
           (v_wg_group_b, v_wg_viewer, 'member')
    on conflict do nothing;

  -- v_wg_a's date: 100 days out -- outside a 30-day window.
  -- v_wg_b's date: 5 days out -- inside a 30-day window.
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_wg_a, 'dates', 'anniversary', to_char(current_date + 100, 'YYYY-MM-DD'),
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'),
           (v_wg_b, 'dates', 'anniversary', to_char(current_date + 5, 'YYYY-MM-DD'),
            '{"visibleToGroupTypes": ["friends"], "restrictToGroup": null}');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_wg_a, v_wg_b, 'confirmed', v_wg_a, to_char(current_date + 100, 'YYYY-MM-DD'), now());

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

  ---------------------------------------------------------------------------
  -- Assertion 13: v_up_viewer_both, who can see BOTH v_up_a's and v_up_b's
  -- anniversary, gets exactly ONE row from get_upcoming_occasions() for the
  -- couple -- keyed to the canonical partner (v_up_a), with BOTH partner
  -- columns populated (not null).
  --
  -- FALSIFIABLE: deleting the couple arm from the live body
  -- (20260912000011_derivation_partner.sql) -- leaving only the per-person
  -- branch (with its exclusion intact) and the group_date branch -- makes
  -- this fail: the exclusion still suppresses both individual rows (it does
  -- not depend on a merge arm existing to catch them), so the count drops to
  -- 0, not 1 -- verified by mutation against a scratch copy, see the task
  -- report. NOT caught: a couple arm that fires but returns the WRONG
  -- partner identity (out of scope for a row-count-plus-null-check
  -- assertion; the partner id/username/display_name equality checks below
  -- catch a wrong-identity bug directly).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_up_viewer_both || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(celebrant_id), max(partner_id),
         max(partner_username), max(partner_display_name)
    into v_up_count, v_up_celebrant, v_up_partner,
         v_up_partner_uname, v_up_partner_dname
    from public.get_upcoming_occasions(400)
   where kind = 'anniversary' and celebrant_id in (v_up_a, v_up_b);

  perform set_config('role', v_orig_role, true);

  if v_up_count <> 1
     or v_up_celebrant is distinct from v_up_a
     or v_up_partner is distinct from v_up_b
     or v_up_partner_uname is null
     or v_up_partner_dname is null
  then
    raise exception
      'RLS FAIL: viewer % who can see BOTH anniversary dates got % row(s) (celebrant_id=%, partner_id=%, partner_username=%, partner_display_name=%), expected exactly 1 row with celebrant_id=%, partner_id=% and both partner name columns populated',
      v_up_viewer_both, v_up_count, v_up_celebrant, v_up_partner,
      v_up_partner_uname, v_up_partner_dname, v_up_a, v_up_b;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 14 (CRITICAL, 2 checks, both directions): a viewer who can see
  -- only ONE partner's date gets exactly ONE row for that person, with
  -- partner columns NULL -- not the merged row, and not zero rows. This is
  -- the assertion that proves the collapse is PER VIEWER rather than
  -- global: an implementation that merges whenever a confirmed link exists
  -- (rather than whenever THIS VIEWER can see both dates) passes assertions
  -- 13, 15 and 16 unchanged and fails only this one, because the widened
  -- exclusion would suppress this person's individual row while the couple
  -- arm still refuses to fire (it cannot see the other partner's date),
  -- leaving zero rows for a viewer entitled to exactly one.
  --
  -- FALSIFIABLE: widening the live body's
  -- (20260912000011_derivation_partner.sql) per-person exclusion to drop its
  -- `public.can_view_field(p2.user_id, v_viewer, p2.privacy_settings)`
  -- conjunct -- excluding a person whenever ANY confirmed link names them,
  -- regardless of what this viewer can see -- makes BOTH checks below fail
  -- (count drops from 1 to 0 in each direction), while leaving assertions
  -- 13, 15 and 16 passing unchanged -- verified by mutation against a
  -- scratch copy, see the task report. NOT caught: a couple arm whose OWN
  -- can_view_field() calls are wrong in a way that happens to still refuse
  -- to fire here (out of scope; assertion 13 covers the couple arm firing
  -- correctly when it should).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_up_viewer_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(celebrant_id), max(partner_id)
    into v_up_count, v_up_celebrant, v_up_partner
    from public.get_upcoming_occasions(400)
   where kind = 'anniversary' and celebrant_id in (v_up_a, v_up_b);

  perform set_config('role', v_orig_role, true);

  if v_up_count <> 1 or v_up_celebrant is distinct from v_up_a or v_up_partner is not null then
    raise exception
      'RLS FAIL: viewer % who can see only v_up_a''s date got % row(s) (celebrant_id=%, partner_id=%), expected exactly 1 row with celebrant_id=% and partner_id NULL -- neither merged nor hidden',
      v_up_viewer_a, v_up_count, v_up_celebrant, v_up_partner, v_up_a;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_up_viewer_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(celebrant_id), max(partner_id)
    into v_up_count, v_up_celebrant, v_up_partner
    from public.get_upcoming_occasions(400)
   where kind = 'anniversary' and celebrant_id in (v_up_a, v_up_b);

  perform set_config('role', v_orig_role, true);

  if v_up_count <> 1 or v_up_celebrant is distinct from v_up_b or v_up_partner is not null then
    raise exception
      'RLS FAIL: viewer % who can see only v_up_b''s date got % row(s) (celebrant_id=%, partner_id=%), expected exactly 1 row with celebrant_id=% and partner_id NULL -- the symmetric direction of the per-viewer collapse',
      v_up_viewer_b, v_up_count, v_up_celebrant, v_up_partner, v_up_b;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 15: v_up_viewer_neither, who can see NEITHER date, gets ZERO
  -- rows for the couple.
  --
  -- FALSIFIABLE: deleting the live body's
  -- (20260912000011_derivation_partner.sql) per-person visibility gate
  -- (`public.can_view_field(pi.user_id, v_viewer, pi.privacy_settings)`)
  -- makes this fail: the exclusion's own exists() check depends on
  -- can_view_field(partner), which is also false for this viewer, so it does
  -- not suppress the leak -- both individual rows appear, count becomes 2
  -- instead of 0 -- verified by mutation against a scratch copy, see the
  -- task report. NOT caught: a couple arm that incorrectly fires for this
  -- viewer (out of scope; the couple arm's own two can_view_field() calls
  -- are unrelated to the per-person branch's gate this mutation removes).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_up_viewer_neither || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_up_count
    from public.get_upcoming_occasions(400)
   where kind = 'anniversary' and celebrant_id in (v_up_a, v_up_b);

  perform set_config('role', v_orig_role, true);

  if v_up_count <> 0 then
    raise exception
      'RLS FAIL: viewer % who can see NEITHER anniversary date got % row(s) for the couple, expected 0',
      v_up_viewer_neither, v_up_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 16: an UNLINKED user (no anniversary_links row of any status)
  -- with their own anniversary on file is unaffected by Task 5's exclusion --
  -- their self-view still gets exactly one row, celebrant_id themself,
  -- partner_id NULL.
  --
  -- FALSIFIABLE: widening the live body's
  -- (20260912000011_derivation_partner.sql) exclusion to
  -- `not (pi.field_name = 'anniversary')` -- dropping the exists(...) check
  -- against anniversary_links entirely, so every anniversary row is excluded
  -- unconditionally -- makes this fail: v_up_unlinked's own row disappears
  -- (count 0, not 1) even though no link of any kind names them, and the
  -- couple arm has nothing to emit in its place -- verified by mutation
  -- against a scratch copy, see the task report. NOT caught: an exclusion
  -- wired to the wrong link STATUS filter (assertion 13/14 would catch a
  -- status filter broad enough to also affect the confirmed-couple fixture,
  -- and v_up_unlinked has no anniversary_links row of any status to exercise
  -- that distinction).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_up_unlinked || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(celebrant_id), max(partner_id)
    into v_up_count, v_up_celebrant, v_up_partner
    from public.get_upcoming_occasions(400)
   where kind = 'anniversary' and celebrant_id = v_up_unlinked;

  perform set_config('role', v_orig_role, true);

  if v_up_count <> 1 or v_up_celebrant is distinct from v_up_unlinked or v_up_partner is not null then
    raise exception
      'RLS FAIL: unlinked user % got % row(s) (celebrant_id=%, partner_id=%), expected exactly 1 row with celebrant_id=% and partner_id NULL',
      v_up_unlinked, v_up_count, v_up_celebrant, v_up_partner, v_up_unlinked;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 17 (CRITICAL, round-1 review, window axis): a confirmed
  -- couple whose CANONICAL (v_wg_a) date is OUTSIDE a bounded 30-day window
  -- and whose NON-canonical (v_wg_b) date is INSIDE it, for a viewer who can
  -- see BOTH. Expect exactly 1 row -- v_wg_b's own, unmerged, celebrant_id =
  -- v_wg_b, partner_id NULL -- because the couple arm's own window check
  -- (gated on the CANONICAL partner's date) correctly declines to fire, and
  -- the per-person exclusion must not remove v_wg_b's row just because a
  -- confirmed, visible link exists: doing so would leave NEITHER arm
  -- emitting a row for a viewer entitled to see one.
  --
  -- FALSIFIABLE: reverting the live body
  -- (20260912000013_derivation_window_guard.sql) to
  -- 20260912000011_derivation_partner.sql's ORIGINAL exclusion -- the one
  -- without the `d2.celebration is not null and d2.celebration between
  -- current_date and v_until` conjunct -- makes this fail: the exclusion
  -- fires on visibility alone (a confirmed link exists and the viewer can
  -- see v_wg_a's date), removing v_wg_b's row, while the couple arm still
  -- declines (v_wg_a's own date is 100 days out, outside the 30-day window)
  -- -- count drops to 0 -- verified by mutation against a scratch copy, see
  -- the task report. NOT caught by assertion 14 (its fixture uses identical
  -- dates for both partners, so it never exercises a couple whose two dates
  -- straddle the window boundary).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_wg_viewer || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(celebrant_id), max(partner_id)
    into v_wg_count, v_wg_celebrant, v_wg_partner
    from public.get_upcoming_occasions(30)
   where kind = 'anniversary' and celebrant_id in (v_wg_a, v_wg_b);

  perform set_config('role', v_orig_role, true);

  if v_wg_count <> 1 or v_wg_celebrant is distinct from v_wg_b or v_wg_partner is not null then
    raise exception
      'RLS FAIL: viewer % saw % row(s) (celebrant_id=%, partner_id=%) for a couple whose canonical partner''s date is OUT of window and whose other partner''s is IN window, expected exactly 1 row with celebrant_id=% and partner_id NULL -- the window-axis guard must keep the in-window partner''s own row visible when the couple arm cannot fire',
      v_wg_viewer, v_wg_count, v_wg_celebrant, v_wg_partner, v_wg_b;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 18 (FINDING I1, 2 checks). THE SPEC'S OWN "DONE WHEN" #3:
  -- tagging from EITHER partner's list and claiming from EITHER land on the
  -- SAME occasion id. Nothing in this repository asserted it before this
  -- round, and it was FALSE: lib/actions/item-occasions.ts's
  -- tagItemForMyOccasion calls get_or_create_occasion, which until
  -- 20260912000015 inserted unconditionally under the caller with no couple
  -- resolution at all -- so a couple who tagged before claiming ended up with
  -- TWO occasion rows, two claim scopes and two tag partitions carrying the
  -- same "Alex & Sam's Anniversary" label. Assertions 7-8 could not see it:
  -- they exercise only get_or_create_celebrated_occasion, the half that was
  -- already link-aware.
  --
  -- The call ORDER matters and reproduces the original defect exactly:
  -- TAGGING from the NON-canonical partner's list goes first, because that
  -- is the call that used to create the stray second row. Four calls in all,
  -- covering both paths from both sides, since "either ... and either" is
  -- what the spec says.
  --
  -- FOUR checks, and TWO of them run mid-sequence. Checks (c) and (d) are
  -- the TAG-ONLY CHECKPOINT, physically placed between the two tagging calls
  -- and the two claiming calls below, because that is the only point at which
  -- get_or_create_occasion's own work is observable -- see their own comment
  -- for what was wrong with reading those columns only at the end.
  --
  -- Check (a) is the four-way id equality. Check (b) counts the actual
  -- occasion rows for the pair, which is the non-vacuous companion: (a)
  -- alone would still pass a function that returned one id while leaving a
  -- second, orphaned row behind, and it is the row count -- not the id --
  -- that determines whether a giver sees one anniversary section or two.
  --
  -- FALSIFIABLE: reverting get_or_create_occasion to its pre-I1 body
  -- (20260911000001_get_or_create_occasion_returning.sql -- no resolution
  -- block, insert keyed to v_caller with no partner_id) makes BOTH checks
  -- fail -- verified by mutation inside begin/rollback against the live
  -- project, see the final fix report. NOT caught: a resolution that lands
  -- on one row but with the wrong DATE (assertion 20), or reversed
  -- celebrant/partner columns (assertion 19).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_tg_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.get_or_create_occasion('anniversary') into v_tg_tag_b;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_tg_a || '","role":"authenticated"}', true);

  select public.get_or_create_occasion('anniversary') into v_tg_tag_a;

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 18c/18d (RE-REVIEW FINDING 3, 2 checks). THE TAG-ONLY
  -- CHECKPOINT -- get_or_create_occasion's own celebrant_id and partner_id,
  -- read HERE because by the end of this block they are no longer its work.
  --
  -- WHAT WAS UNCOVERED, AND HOW IT WAS FOUND. Strip partner_id out of
  -- get_or_create_occasion's insert and its `do update` -- the exact
  -- pre-20260912000015 shape, celebrant resolution left in place -- and
  -- assertions 18a, 18b, 19a, 19b and 20 ALL still pass. The fourth call in
  -- this sequence is get_or_create_celebrated_occasion, whose
  -- `do update set ... partner_id = excluded.partner_id` writes the correct
  -- partner_id onto the same row before assertion 19 ever reads it. So the
  -- file asserted a property of the row, not a property of the function that
  -- created it, and 19b's error message named a regression the file could not
  -- catch. Reproduced on a LOCAL scratch replica of these two functions'
  -- objects, loaded from the migration files unedited, on a 2026-09-12 run:
  --
  --   BASELINE        18c passes  18d passes  18a/18b/19a/19b/20 pass
  --   partner stripped 18c passes 18d FIRES   18a/18b/19a/19b/20 ALL PASS
  --
  -- WHY THE ROW MUST ALREADY BE RIGHT AT THIS POINT, rather than merely right
  -- eventually. lib/actions/item-occasions.ts:44's tagItemForMyOccasion calls
  -- get_or_create_occasion and NOT the celebrated variant -- that asymmetry is
  -- the root of finding I1 -- so a couple who only ever tags leaves this row
  -- exactly as this function wrote it, with no later call to repair it. A row
  -- with celebrant_id set but partner_id null is invisible to the `occasions`
  -- SELECT policy's partner branch (the partner-side viewer never sees the
  -- shared occasion), never renders both names, and cannot be found by
  -- unlink_anniversary's `where celebrant_id = v_link.user_a and partner_id =
  -- v_link.user_b` cleanup after a breakup.
  --
  -- ALSO OBSERVED on the same replica, as a bonus rather than as the purpose:
  -- reversing `into v_partner, v_target` in get_or_create_occasion alone fires
  -- 18c and 18d here, ahead of assertion 18a -- the failure is reported
  -- against the function that caused it instead of against the pair's id
  -- count several calls later.
  --
  -- Role is restored for the read and re-taken afterwards, matching how every
  -- other assertion in this file reads tables back.
  ---------------------------------------------------------------------------
  select celebrant_id, partner_id into v_tg_tag_celebrant, v_tg_tag_partner
    from public.occasions where id = v_tg_tag_b;

  if v_tg_tag_celebrant is distinct from v_tg_a then
    raise exception
      'RLS FAIL: after TAGGING alone -- no claim call has run yet -- the couple''s occasion has celebrant_id=%, expected the CANONICAL (lexicographically smaller) partner % -- get_or_create_occasion must resolve the couple in its own body',
      v_tg_tag_celebrant, v_tg_a;
  end if;
  v_checks := v_checks + 1;

  if v_tg_tag_partner is distinct from v_tg_b then
    raise exception
      'RLS FAIL: after TAGGING alone -- no claim call has run yet -- the couple''s occasion has partner_id=%, expected the non-canonical partner % -- get_or_create_occasion must write partner_id ITSELF, as it did not before 20260912000015; a tag-first couple never calls get_or_create_celebrated_occasion, so nothing later repairs this row',
      coalesce(v_tg_tag_partner, '<null>'), v_tg_b;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_tg_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.get_or_create_celebrated_occasion(v_tg_a, 'anniversary')
    into v_tg_claim_a;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_tg_b || '","role":"authenticated"}', true);

  select public.get_or_create_celebrated_occasion(v_tg_b, 'anniversary')
    into v_tg_claim_b;

  perform set_config('role', v_orig_role, true);

  if v_tg_tag_b is null
     or v_tg_tag_a is distinct from v_tg_tag_b
     or v_tg_claim_a is distinct from v_tg_tag_b
     or v_tg_claim_b is distinct from v_tg_tag_b
  then
    raise exception
      'RLS FAIL: a confirmed couple did not resolve to ONE occasion id -- tag-as-non-canonical=%, tag-as-canonical=%, claim-naming-canonical=%, claim-naming-non-canonical=% -- the spec''s "done when" #3 requires tagging from either partner''s list and claiming from either to land on the same occasion',
      v_tg_tag_b, v_tg_tag_a, v_tg_claim_a, v_tg_claim_b;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_tg_rows
    from public.occasions
   where kind = 'anniversary' and celebrant_id in (v_tg_a, v_tg_b);

  if v_tg_rows <> 1 then
    raise exception
      'RLS FAIL: couple (%, %) has % anniversary occasion row(s) after tagging and claiming from both sides, expected exactly 1 -- two rows is the defect this feature exists to remove',
      v_tg_a, v_tg_b, v_tg_rows;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 19 (FINDING I1, 2 checks): the one surviving row is keyed to
  -- the CANONICAL partner with the other in partner_id, checked as two
  -- separate conditions so a swap is its own visible failure rather than
  -- being hidden behind "some row with the right two ids exists".
  --
  -- Assertion 8 makes the same check for get_or_create_celebrated_occasion.
  -- This one is NOT redundant with it: the row here may have been created by
  -- get_or_create_occasion (the tagging path, which ran first above), and
  -- that function is a separate body with its own copy of the resolution.
  -- A mirror row from EITHER function would be invisible to
  -- unlink_anniversary's `where celebrant_id = v_link.user_a and partner_id =
  -- v_link.user_b` scoping, stranding a stale partner_id after a breakup.
  --
  -- FALSIFIABILITY, STATED AS OBSERVED RATHER THAN AS HOPED. Two direction
  -- mutations were run inside begin/rollback against the live project:
  --
  --   * reversing `into v_partner, v_target` in BOTH functions -- assertion
  --     8 fires first (it sits earlier in this file and tests
  --     get_or_create_celebrated_occasion directly);
  --   * reversing it in get_or_create_occasion ALONE -- assertion 18 fires,
  --     because the two functions then disagree about which id the row is
  --     keyed to and the couple ends up with two rows.
  --
  -- So these two checks did NOT fire independently under either mutation,
  -- and this comment says so rather than claiming a bite they do not have --
  -- this file has twice shipped a falsifiability claim that was provably
  -- false. What they are worth keeping for: they LOCALISE the failure. A
  -- direction regression reaching here reports "the one row is keyed to the
  -- wrong partner" instead of "the ids do not match", which is the
  -- difference between a five-minute diagnosis and an hour of it -- and if
  -- assertion 7/8's fixture were ever removed, these become the only
  -- coverage of get_or_create_occasion's own copy of the direction.
  ---------------------------------------------------------------------------
  select celebrant_id, partner_id into v_tg_celebrant, v_tg_partner
    from public.occasions where id = v_tg_tag_b;

  if v_tg_celebrant is distinct from v_tg_a then
    raise exception
      'RLS FAIL: the couple''s single occasion has celebrant_id=%, expected the CANONICAL (lexicographically smaller) partner %',
      v_tg_celebrant, v_tg_a;
  end if;
  v_checks := v_checks + 1;

  if v_tg_partner is distinct from v_tg_b then
    raise exception
      'RLS FAIL: the couple''s single occasion has partner_id=%, expected the non-canonical partner % -- get_or_create_occasion must write partner_id, not leave it null as it did before 20260912000015',
      v_tg_partner, v_tg_b;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 20 (FINDING I4, 1 check): the shared row's date comes from the
  -- CANONICAL partner, whoever materialized it and in whatever order.
  --
  -- Both functions used to derive the date from the celebrant the CALLER
  -- named and then upsert under the canonical id with
  -- `do update set occasion_date = excluded.occasion_date`, so the row's date
  -- was last-writer-wins by whoever clicked. Reproduced on the live project
  -- inside begin/rollback: A materialized -> 2026-10-22, B materialized the
  -- SAME row -> 2026-09-14.
  --
  -- That reaches the claim lifecycle rather than only the label:
  -- 20260911100002_claim_rpcs.sql releases every claim whose
  -- `o.occasion_date < current_date`, so a viewer shown the later date has
  -- their claim auto-released weeks early, freeing the item and inviting the
  -- duplicate gift claiming exists to prevent.
  --
  -- v_tg_b (whose own date is 09-14) made BOTH of the last two calls above,
  -- so the row would carry 09-14 under the old behaviour; it must carry
  -- v_tg_a's 03-04. Month/day only, so the this-year-or-next rollover
  -- celebration_date_in_year() applies cannot make this calendar-dependent.
  --
  -- FALSIFIABILITY, AND THE CALENDAR CAVEAT THAT GOES WITH IT -- stated as
  -- observed, because a wrong claim here is the defect class this file has
  -- already been corrected for twice.
  --
  -- The mutation is: disable the `if v_partner is not null and v_target is
  -- distinct from ... then ... v_value := v_canon; end if;` block in
  -- 20260912000015 or 20260912000016. Both were run inside begin/rollback
  -- against the live project. WHICH assertion reports it depends on where in
  -- the calendar the suite runs, because occasions_celebrant_identity keys
  -- on occasion_year:
  --
  --   * when the couple's two dates fall in DIFFERENT occasion_years (03-04
  --     and 09-14 do, for any run between 4 March and 13 September), the
  --     mutated call materializes a SEPARATE row and ASSERTION 18 fires
  --     -- observed, for both functions, on a 12 September run;
  --   * when they share an occasion_year (any other run date), the mutated
  --     call lands on the same row and rewrites its date, and THIS assertion
  --     fires -- proven by re-running the same mutation against a scratch
  --     copy of this file with the canonical anchor moved to 09-20, which
  --     produced exactly this raise: "the couple's shared occasion is dated
  --     09-14 but the CANONICAL partner ...'s own anniversary is ...".
  --
  -- So the mutation is caught year-round, by 18 or by 20, and BOTH halves
  -- were observed firing. The anchors stay fixed rather than offset from
  -- current_date: a pair of DIFFERENT dates guaranteed to share an
  -- occasion_year on every possible run date does not exist (any such pair
  -- straddles the year boundary somewhere), so choosing offsets would trade
  -- a documented calendar-dependence for an undocumented one.
  --
  -- NOT caught: the early-auto-release consequence itself, which needs the
  -- clock to advance past one date but not the other and so cannot be
  -- observed inside a single transaction. Date stability is the property
  -- that prevents it, and that is what this asserts.
  ---------------------------------------------------------------------------
  select to_char(occasion_date, 'MM-DD') into v_tg_monthday
    from public.occasions where id = v_tg_tag_b;

  if v_tg_monthday is distinct from '03-04' then
    raise exception
      'RLS FAIL: the couple''s shared occasion is dated % but the CANONICAL partner %''s own anniversary is 03-04 (the non-canonical partner %''s is 09-14) -- a partnered occasion''s date must come from the canonical partner, not from whichever partner materialized it last',
      v_tg_monthday, v_tg_a, v_tg_b;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 21 (FINDING I4, 1 check): a claim already scoped to a couple's
  -- shared occasion survives the OTHER partner materializing afterwards,
  -- with the occasion's date unmoved.
  --
  -- This is the lifecycle half of assertion 20, on the fixture that already
  -- holds a real claim (assertion 11's v_pc_* couple and gifter). The
  -- sequence is the reported failure exactly: the non-canonical partner's
  -- side materialized and a gifter claimed against it (assertion 11 above),
  -- and now the CANONICAL partner materializes the same row. Before finding
  -- I4's fix that second call rewrote occasion_date under the live claim.
  --
  -- Both v_pc partners carry the same profile date, so this assertion pins
  -- STABILITY (the date does not move, and the claim is untouched) rather
  -- than WHICH date wins -- that is assertion 20's job, on a fixture whose
  -- two dates differ. Kept separate because the two failures are different:
  -- a date that moves under a live claim is a lifecycle bug even when the
  -- value it moves to is the canonical one.
  --
  -- FALSIFIABLE: making the resolution write the NAMED celebrant's date
  -- while still upserting under the canonical id -- i.e. the pre-fix
  -- behaviour -- combined with differing v_pc dates makes the date check
  -- fail. As shipped (identical v_pc dates) the date check cannot fail on
  -- value alone, so this assertion's live bite is the claim-survival half:
  -- verified by mutating claim_wishlist_item's upsert to release on
  -- re-materialization, which fails `active claims = 1`. Stated plainly
  -- rather than overclaimed -- this file has been corrected twice for
  -- asserting a falsifiability it did not have.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_pc_canon || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.get_or_create_celebrated_occasion(v_pc_canon, 'anniversary');

  perform set_config('role', v_orig_role, true);

  select count(*) into v_pc_active_claims
    from wishlist_claims
   where item_id = v_pc_item
     and claimed_by = v_pc_gifter
     and released_at is null
     and occasion_id = v_pc_occasion;

  if v_pc_active_claims <> 1 then
    raise exception
      'RLS FAIL: after the canonical partner % re-materialized the shared occasion %, the gifter %''s claim on item % is no longer a single active claim scoped to it (% row(s)) -- re-materializing must not disturb a live claim',
      v_pc_canon, v_pc_occasion, v_pc_gifter, v_pc_item, v_pc_active_claims;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 28 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 28', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_20_shared_anniversary_reads');
end $$;

select token as result from _harness_result;
