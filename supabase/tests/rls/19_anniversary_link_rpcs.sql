-- request_anniversary_link / confirm_anniversary_link / decline_anniversary_link
-- / unlink_anniversary -- the four SECURITY DEFINER RPCs that own every write
-- to anniversary_links and anniversary_link_members (20260912000003).
--
-- CORRECTION TO THE ORIGINAL TASK-3 BRIEF, recorded here because it changes
-- the shape of this file. The brief's assertion list covered decline, unlink
-- and confirm live, plus request's GUARDS as anchored source checks -- but no
-- live call ever exercises request_anniversary_link succeeding. Every other
-- assertion's fixture inserts the anniversary_links row directly as the
-- connecting role, so an implementation whose request_anniversary_link never
-- worked at all -- always raised, or inserted nothing -- would have passed
-- this entire file. Assertion 8 below closes that: a co-member calls it live
-- and the resulting row's canonical ordering, initiator and date are checked
-- directly. This matters specifically because canonical ordering
-- (least/greatest into user_a/user_b) is the invariant occasions_celebrant_
-- identity and anniversary_links_canonical both rest on -- get it backwards
-- and the CHECK constraint raises, aborting this file's batch rather than
-- failing an assertion, so the positive form is the only one that reports
-- usefully.
--
-- SECOND CORRECTION, load-bearing. confirm_anniversary_link populates
-- anniversary_link_members (20260912000001), the table whose PRIMARY KEY is
-- what actually enforces "one CONFIRMED anniversary link per person, either
-- side" -- anniversary_links' own two partial unique indexes cannot express
-- that cross-column invariant (see that migration's header). Assertion 11
-- below anchors the three pieces of that write path in source: the pre-check
-- (a message written for a human), the unconditional two-row insert (the
-- race backstop -- a concurrent confirm that slipped past the pre-check
-- still collides with the primary key here), and the `unique_violation`
-- handler translating that collision to the SAME message the pre-check
-- gives. It cannot be tested live: tripping either one RAISES, and this
-- harness bans exception handlers in test files file-wide
-- (scripts/test-rls.sh:276-279) and sends this whole file as one batch, so an
-- uncaught raise here would abort every other assertion. What IS live is
-- assertion 5's population check -- that a genuine confirm actually writes
-- both rows -- which proves the writer runs, not merely that it exists in
-- source.
--
-- THIRD CORRECTION: reconciliation (assertion 7) is not a defensive branch
-- being exercised hypothetically. The live database already holds a real
-- materialized anniversary occasion for a real user; the first confirm
-- touching them runs this code for real. An implementation that confirms the
-- link but skips reconciliation passes every other assertion in this file
-- untouched -- assertion 7 is the one that would catch it, checked in both
-- directions per the task report: the couple ends with exactly one occasion
-- (not two), and nothing that already existed -- either partner's tag, the
-- one claim in the fixture -- is silently dropped in the move.
--
-- Every anchored check below follows 13_occasion_materialization.sql's
-- corrected pattern: each regex carries its OWN (?n), every pattern is
-- line-anchored (^\s*...$), every pg_proc lookup is scoped by exact
-- ::regprocedure identity (not proname, so an ungated overload cannot
-- satisfy a count), and a standalone `position('/*' in pg_get_functiondef(
-- ...)) = 0` check floors every anchored pattern against each of the four
-- functions -- line-anchoring alone does not defend against a `/* ... */`
-- block comment, which leaves every line byte-identical and merely brackets
-- them.
--
-- None of these regex patterns spell the literal sequence "exception" then
-- whitespace then "when": that sequence is what the harness's own
-- `exception[[:space:]]+when` scan (scripts/test-rls.sh:276-279) looks for,
-- comment-stripped, file-wide. "raise exception '...'" is unaffected (the
-- word after "exception" there is a quote, never "when"), and the handler
-- check below matches only "when unique_violation then" onward -- so this
-- file's own regex literals never manufacture the banned sequence while
-- still proving the handler's shape.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes (including every
-- anniversary_links / anniversary_link_members row inserted directly rather
-- than through an RPC -- there is no INSERT policy on either table, and
-- `authenticated` holds no INSERT privilege on either after their own
-- migrations' revokes, so no other path could have written them here)
-- happen while impersonating the connecting (RLS-bypassing) role. RPC calls
-- run as the specific caller they are testing, so `role`/`request.jwt.claims`
-- are toggled around each one, and back to the captured `current_user`
-- before every verifying read -- a verifying read left running as an
-- impersonated caller can be silently filtered by that table's own RLS
-- (wishlist_claims excludes the item owner; anniversary_links admits only
-- participants), which would make a check pass no matter what happened
-- underneath it.
--
-- Every CONFIRMED-link fixture in this file uses a disjoint set of users:
-- anniversary_link_members' primary key enforces its invariant across the
-- WHOLE table, not scoped to one fixture, so two confirms sharing a user
-- anywhere in this transaction would collide with each other, not just with
-- the case under test.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role         text;
  v_checks            int := 0;

  -- generic scratch, reused across assertions in sequence
  v_bool              boolean;
  v_count             int;
  v_status            text;
  v_confirmed_at      timestamptz;
  v_claim_occasion    uuid;
  v_block_comment_pos int;
  v_guard_defs        int;

  -- assertion 1: decline by the recipient
  v_d1_a   text := 'user_annrpc_d1_a';
  v_d1_b   text := 'user_annrpc_d1_b';
  v_link_d1 uuid;

  -- assertion 2: decline by the initiator
  v_d2_a   text := 'user_annrpc_d2_a';
  v_d2_b   text := 'user_annrpc_d2_b';
  v_link_d2 uuid;

  -- assertion 3: unlink by a non-participant
  v_u3_a   text := 'user_annrpc_u3_a';
  v_u3_b   text := 'user_annrpc_u3_b';
  v_u3_out text := 'user_annrpc_u3_out';
  v_link_u3 uuid;

  -- assertion 4: unlink by either partner (two fixtures, opposite sides)
  v_u4_a    text := 'user_annrpc_u4_a';
  v_u4_b    text := 'user_annrpc_u4_b';
  v_link_u4 uuid;
  v_occ_u4  uuid;
  v_item_u4 uuid;

  v_u4c_a    text := 'user_annrpc_u4c_a';
  v_u4c_b    text := 'user_annrpc_u4c_b';
  v_link_u4c uuid;

  -- assertion 5: confirm by the recipient, overwriting a prior date
  v_c5_a   text := 'user_annrpc_c5_a';
  v_c5_b   text := 'user_annrpc_c5_b';
  v_link_c5 uuid;

  -- assertion 6: confirm with no prior anniversary on file
  v_c6_a   text := 'user_annrpc_c6_a';
  v_c6_b   text := 'user_annrpc_c6_b';
  v_link_c6 uuid;

  -- assertion 7: reconciliation
  v_r_a        text := 'user_annrpc_recon_a';
  v_r_b        text := 'user_annrpc_recon_b';
  v_r_claimer  text := 'user_annrpc_recon_claimer';
  v_occ_r_a    uuid;
  v_occ_r_b    uuid;
  v_item_r_a   uuid;
  v_item_r_b   uuid;
  v_claim_r    uuid;
  v_link_r     uuid;

  -- assertion 8: request_anniversary_link success
  v_req_alice text := 'user_annrpc_req_alice';
  v_req_zoe   text := 'user_annrpc_req_zoe';
  v_group_req uuid;
  v_link_req  uuid;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures for assertions 1-4, written as the connecting role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name) values
    (v_d1_a,   'annrpcd1a',   'AnnRPC D1 A'),
    (v_d1_b,   'annrpcd1b',   'AnnRPC D1 B'),
    (v_d2_a,   'annrpcd2a',   'AnnRPC D2 A'),
    (v_d2_b,   'annrpcd2b',   'AnnRPC D2 B'),
    (v_u3_a,   'annrpcu3a',   'AnnRPC U3 A'),
    (v_u3_b,   'annrpcu3b',   'AnnRPC U3 B'),
    (v_u3_out, 'annrpcu3out', 'AnnRPC U3 Outsider'),
    (v_u4_a,   'annrpcu4a',   'AnnRPC U4 A'),
    (v_u4_b,   'annrpcu4b',   'AnnRPC U4 B'),
    (v_u4c_a,  'annrpcu4ca',  'AnnRPC U4C A'),
    (v_u4c_b,  'annrpcu4cb',  'AnnRPC U4C B');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_d1_a, v_d1_b, 'pending', v_d1_a, '2011-01-01')
    returning id into v_link_d1;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_d2_a, v_d2_b, 'pending', v_d2_a, '2012-02-02')
    returning id into v_link_d2;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_u3_a, v_u3_b, 'pending', v_u3_a, '2013-03-03')
    returning id into v_link_u3;

  -- assertion 4, fixture 1: a genuinely CONFIRMED link with a real occasion,
  -- partner_id set, and one tag -- so "leaves the occasion and its tags in
  -- place" is checked against something that actually exists, not an absence
  -- that would pass regardless. Inserted directly (status='confirmed') along
  -- with its anniversary_link_members rows: unlink_anniversary never reads
  -- that table, but it must not leave it inconsistent, and the FK's ON
  -- DELETE CASCADE is what this fixture proves against below.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_u4_a, v_u4_b, 'confirmed', v_u4_a, '2020-05-05', now())
    returning id into v_link_u4;

  insert into anniversary_link_members (user_id, link_id)
    values (v_u4_a, v_link_u4), (v_u4_b, v_link_u4);

  insert into occasions (celebrant_id, partner_id, kind, occasion_date)
    values (v_u4_a, v_u4_b, 'anniversary', '2026-05-05')
    returning id into v_occ_u4;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_u4_a, 'AnnRPC U4 Item',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item_u4;

  insert into wishlist_item_occasions (item_id, occasion_id)
    values (v_item_u4, v_occ_u4);

  -- assertion 4, fixture 2: the SAME shape, minimal (no occasion needed --
  -- assertion 4's occasion/tag survival is already proven by fixture 1), used
  -- only to prove the CANONICAL (user_a) side can unlink too. Without this
  -- second fixture, an unlink_anniversary that accidentally checked only
  -- `v_caller = v_link.user_b` would pass fixture 1 (called as user_b) and
  -- this file would never notice it silently excludes user_a.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_u4c_a, v_u4c_b, 'confirmed', v_u4c_a, '2021-06-06', now())
    returning id into v_link_u4c;

  insert into anniversary_link_members (user_id, link_id)
    values (v_u4c_a, v_link_u4c), (v_u4c_b, v_link_u4c);

  ---------------------------------------------------------------------------
  -- Assertion 1 (2 checks): decline_anniversary_link by the RECIPIENT
  -- returns true, and the row is gone.
  --
  -- FALSIFIABLE: flip the DELETE's `initiated_by <> v_caller` to `=`, or drop
  -- it, and this fails (the recipient would be denied, or an unrelated
  -- caller would delete it -- either way the return value and/or the
  -- survival check changes). NOT caught: reordering decline's other
  -- predicates, or a message-text change on an unrelated raise.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_d1_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.decline_anniversary_link(v_link_d1) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from true then
    raise exception
      'RPC FAIL: decline_anniversary_link by the recipient % returned %, expected true',
      v_d1_b, v_bool;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_d1;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: anniversary_links still has % row(s) for id % after the recipient declined, expected 0',
      v_count, v_link_d1;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2 (2 checks): decline_anniversary_link by the INITIATOR
  -- returns false, and the row survives, still pending. Only the recipient
  -- may decline.
  --
  -- FALSIFIABLE: drop the `initiated_by <> v_caller` predicate and this
  -- fails (the initiator could delete their own outgoing request). NOT
  -- caught: an initiator-decline that raises instead of returning false --
  -- the function's own header rules that out as a design choice, not
  -- something this assertion re-verifies.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_d2_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.decline_anniversary_link(v_link_d2) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from false then
    raise exception
      'RPC FAIL: decline_anniversary_link by the initiator % returned %, expected false -- only the recipient may decline',
      v_d2_a, v_bool;
  end if;
  v_checks := v_checks + 1;

  select status into v_status from anniversary_links where id = v_link_d2;
  if v_status is distinct from 'pending' then
    raise exception
      'RPC FAIL: anniversary_links row % has status % after a denied decline, expected it untouched at pending',
      v_link_d2, v_status;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3 (2 checks): unlink_anniversary by a NON-PARTICIPANT returns
  -- false, and the row survives.
  --
  -- FALSIFIABLE: drop the `v_caller not in (...)` guard (return false only
  -- when v_link is null) and this fails -- any authenticated caller could
  -- unlink any pair. NOT caught: a non-participant call that raises instead
  -- of returning false.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_u3_out || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.unlink_anniversary(v_link_u3) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from false then
    raise exception
      'RPC FAIL: unlink_anniversary by non-participant % returned %, expected false',
      v_u3_out, v_bool;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_u3;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: anniversary_links has % row(s) for id % after a denied unlink by a non-participant, expected 1 (untouched)',
      v_count, v_link_u3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4 (6 checks): unlink_anniversary by EITHER partner returns
  -- true, clears partner_id, and leaves the occasion row and its tags in
  -- place. Fixture 1 is called by user_b (non-canonical); fixture 2 by
  -- user_a (canonical) -- see the fixture comments above for why both sides
  -- get their own call.
  --
  -- FALSIFIABLE (checks 1-4, fixture 1): remove the `partner_id = null`
  -- UPDATE and check 3 fails; make unlink DELETE the occasion (or its tag)
  -- instead of just the link and checks 3/4 fail. NOT caught: an unlink that
  -- also mutates the OTHER partner's unrelated data, since nothing here
  -- reads it.
  -- FALSIFIABLE (checks 5-6, fixture 2): narrow `v_caller not in (user_a,
  -- user_b)` to test only `user_b` and fixture 2's call (as user_a) starts
  -- returning false, failing check 5. NOT caught: a bug that affects ONLY
  -- the occasion side-effects for the user_a-caller path, since fixture 2
  -- carries no occasion to check (fixture 1 already covers that shape).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_u4_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.unlink_anniversary(v_link_u4) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from true then
    raise exception
      'RPC FAIL: unlink_anniversary by partner % (non-canonical) returned %, expected true',
      v_u4_b, v_bool;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_u4;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: anniversary_links still has % row(s) for id % after unlink, expected 0',
      v_count, v_link_u4;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from occasions where id = v_occ_u4 and partner_id is null;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: occasion % does not have partner_id cleared after unlink (% matching row(s), expected 1)',
      v_occ_u4, v_count;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from wishlist_item_occasions where item_id = v_item_u4 and occasion_id = v_occ_u4;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: tag (item %, occasion %) is gone after unlink (% matching row(s), expected 1) -- unlink must not touch tags',
      v_item_u4, v_occ_u4, v_count;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_u4c_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.unlink_anniversary(v_link_u4c) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from true then
    raise exception
      'RPC FAIL: unlink_anniversary by partner % (canonical) returned %, expected true',
      v_u4c_a, v_bool;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_u4c;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: anniversary_links still has % row(s) for id % after unlink by the canonical partner, expected 0',
      v_count, v_link_u4c;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Fixtures for assertions 5-6.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name) values
    (v_c5_a, 'annrpcc5a', 'AnnRPC C5 A'),
    (v_c5_b, 'annrpcc5b', 'AnnRPC C5 B'),
    (v_c6_a, 'annrpcc6a', 'AnnRPC C6 A'),
    (v_c6_b, 'annrpcc6b', 'AnnRPC C6 B');

  -- v_c5_b already has a DIFFERENT anniversary on file, so a successful
  -- confirm below is provably an OVERWRITE (the ON CONFLICT DO UPDATE
  -- branch), not just a first-time insert -- that shape is what assertion 6
  -- covers separately.
  insert into profile_info (user_id, category, field_name, field_value)
    values (v_c5_b, 'dates', 'anniversary', '1999-01-01');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_c5_a, v_c5_b, 'pending', v_c5_a, '2015-05-05')
    returning id into v_link_c5;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_c6_a, v_c6_b, 'pending', v_c6_a, '2018-08-08')
    returning id into v_link_c6;

  ---------------------------------------------------------------------------
  -- Assertion 5 (3 checks): confirm_anniversary_link by the recipient sets
  -- status = 'confirmed' and OVERWRITES the recipient's existing profile_info
  -- anniversary row with agreed_date; also proves the writer actually
  -- populates anniversary_link_members for BOTH partners (the population
  -- half of the second correction above -- the pre-check/race-backstop half
  -- can only be checked in source, see assertion 11).
  --
  -- FALSIFIABLE: drop the `on conflict ... do update` and this fails (the
  -- pre-existing 1999-01-01 row blocks the insert, so field_value stays
  -- wrong); drop the anniversary_link_members insert and the third check
  -- fails (population never happened, silently leaving the invariant
  -- unenforced exactly as it was before this task). NOT caught: an insert
  -- into anniversary_link_members using the WRONG link_id -- this checks
  -- link_id = v_link_c5 explicitly, so that specific slip is caught, but a
  -- swapped user_id/link_id pairing that still resolves to the same COUNT
  -- would not be (there is no swap possible here: both literals are used for
  -- both rows in one values list, so this residue does not apply to this
  -- function's actual shape).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_c5_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.confirm_anniversary_link(v_link_c5);

  perform set_config('role', v_orig_role, true);

  select status, confirmed_at into v_status, v_confirmed_at
    from anniversary_links where id = v_link_c5;

  if v_status is distinct from 'confirmed' or v_confirmed_at is null then
    raise exception
      'RPC FAIL: anniversary_links % has status=%, confirmed_at=% after confirm, expected confirmed with a timestamp',
      v_link_c5, v_status, v_confirmed_at;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from profile_info
   where user_id = v_c5_b and category = 'dates' and field_name = 'anniversary'
     and field_value = '2015-05-05';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: recipient % has % profile_info anniversary row(s) reading 2015-05-05 after confirm, expected exactly 1 (the prior 1999-01-01 value should have been overwritten)',
      v_c5_b, v_count;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from anniversary_link_members
   where user_id in (v_c5_a, v_c5_b) and link_id = v_link_c5;
  if v_count <> 2 then
    raise exception
      'RPC FAIL: anniversary_link_members has % row(s) for link % after confirm, expected exactly 2 (one per partner) -- confirm_anniversary_link must populate this table, not merely have a table that could',
      v_count, v_link_c5;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6 (2 checks): confirm with the recipient having NO prior
  -- anniversary creates the row (the ON CONFLICT's INSERT branch, the
  -- complement of assertion 5's UPDATE branch).
  --
  -- FALSIFIABLE: the not-vacuous check first proves v_c6_b genuinely has
  -- nothing on file; if the profile_info insert were dropped entirely, the
  -- second check would find 0 rows instead of 1. NOT caught: a wrong
  -- field_value inserted under the right (user_id, category, field_name) --
  -- this checks field_value = agreed_date explicitly, so that is caught too,
  -- but a correct value written to the WRONG user (e.g. the initiator
  -- instead of the recipient) is a separate class this check does not
  -- distinguish from success, since it never queries the initiator's row.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from profile_info
   where user_id = v_c6_b and category = 'dates' and field_name = 'anniversary';
  if v_count <> 0 then
    raise exception
      'HARNESS FAIL: fixture user % already has % anniversary row(s) in profile_info -- assertion 6 would be vacuous',
      v_c6_b, v_count;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_c6_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.confirm_anniversary_link(v_link_c6);

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from profile_info
   where user_id = v_c6_b and category = 'dates' and field_name = 'anniversary'
     and field_value = '2018-08-08';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: recipient % has % profile_info anniversary row(s) reading 2018-08-08 after confirm, expected exactly 1 to have been created',
      v_c6_b, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Fixture for assertion 7: reconciliation. Both partners ALREADY hold a
  -- materialized anniversary occasion for the SAME year (different exact
  -- dates -- 06-15 and 09-20, both 2026 -- so the reconciliation is proven to
  -- key on occasion_year, not on the two dates happening to match), each
  -- with a gift tagged for their own occasion, and one of those items
  -- additionally carries a live claim by a third party. This is the live
  -- shape the task report calls out: the production database already has a
  -- real materialized occasion for a real user, so this is not a
  -- hypothetical branch.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name) values
    (v_r_a,       'annrpcrecona', 'AnnRPC Recon A'),
    (v_r_b,       'annrpcreconb', 'AnnRPC Recon B'),
    (v_r_claimer, 'annrpcreconc', 'AnnRPC Recon Claimer');

  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_r_a, 'anniversary', '2026-06-15') returning id into v_occ_r_a;

  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_r_b, 'anniversary', '2026-09-20') returning id into v_occ_r_b;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_r_a, 'AnnRPC Recon Item A',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item_r_a;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_r_b, 'AnnRPC Recon Item B',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item_r_b;

  insert into wishlist_item_occasions (item_id, occasion_id)
    values (v_item_r_a, v_occ_r_a), (v_item_r_b, v_occ_r_b);

  insert into wishlist_claims (item_id, occasion_id, claimed_by)
    values (v_item_r_b, v_occ_r_b, v_r_claimer)
    returning id into v_claim_r;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_r_a, v_r_b, 'pending', v_r_a, '2026-06-15')
    returning id into v_link_r;

  ---------------------------------------------------------------------------
  -- Assertion 7 (8 checks): reconciliation. Not-vacuous checks first (the
  -- fixture genuinely has two occasions in the same year, and the claim
  -- genuinely points at the non-canonical one, before anything runs), then
  -- the post-confirm state.
  --
  -- FALSIFIABLE, both directions per the task report:
  --   -- delete the whole reconciliation block (an implementation that only
  --      flips status and writes profile_info) and checks (c)-(g) below all
  --      fail: two occasions remain instead of one, v_occ_r_b never gets
  --      deleted, neither tag ends up on the canonical occasion, and the
  --      claim keeps pointing at an occasion that -- in a real
  --      implementation missing this block -- becomes an orphaned second
  --      "anniversary" for the same couple instead of being removed. This is
  --      done live below as its own scratch-function proof, not only
  --      asserted here (see the task report for that proof, run separately
  --      per the brief's Step 5 -- it cannot run inside this file, since the
  --      whole point is confirming a BROKEN copy still completes without
  --      raising, and doing that against the real function name would not
  --      be a "scratch copy").
  --   -- swap `v_link.user_a` / `v_link.user_b` in the reconciliation's own
  --      SELECT/JOIN conditions and check (c2) fails: the surviving
  --      occasion's id would be v_occ_r_b (celebrant v_r_b) with partner_id
  --      pointing the wrong way, not v_occ_r_a with partner_id = v_r_b.
  -- NOT caught: a reconciliation that moves tags/claims correctly but leaves
  -- a stray, orphaned THIRD occasion row unrelated to either partner --
  -- nothing here scans for occasions beyond the two named ids.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from occasions where id in (v_occ_r_a, v_occ_r_b) and occasion_year = 2026;
  if v_count <> 2 then
    raise exception
      'HARNESS FAIL: only % of the 2 fixture occasions resolve to occasion_year 2026, expected 2 -- assertion 7 would not be testing same-year reconciliation',
      v_count;
  end if;
  v_checks := v_checks + 1;

  select occasion_id into v_claim_occasion from wishlist_claims where id = v_claim_r;
  if v_claim_occasion is distinct from v_occ_r_b then
    raise exception
      'HARNESS FAIL: fixture claim % has occasion_id %, expected the non-canonical occasion % -- assertion 7''s re-pointing check would be vacuous',
      v_claim_r, v_claim_occasion, v_occ_r_b;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_r_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.confirm_anniversary_link(v_link_r);

  perform set_config('role', v_orig_role, true);

  -- (c1) exactly ONE occasion remains for the pair.
  select count(*) into v_count
    from occasions where kind = 'anniversary' and celebrant_id in (v_r_a, v_r_b);
  if v_count <> 1 then
    raise exception
      'RPC FAIL: % anniversary occasion(s) remain for the reconciled pair (%, %), expected exactly 1 -- the couple keeps two occasion ids for one event',
      v_count, v_r_a, v_r_b;
  end if;
  v_checks := v_checks + 1;

  -- (c2) it is specifically the CANONICAL occasion (v_occ_r_a, celebrant
  -- v_r_a), now carrying partner_id = v_r_b.
  select count(*) into v_count
    from occasions where id = v_occ_r_a and partner_id = v_r_b;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: canonical occasion % does not have partner_id = % after confirm (% matching row(s), expected 1)',
      v_occ_r_a, v_r_b, v_count;
  end if;
  v_checks := v_checks + 1;

  -- (d) the non-canonical occasion is gone, not merely orphaned.
  select count(*) into v_count from occasions where id = v_occ_r_b;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: non-canonical occasion % still exists after confirm (% row(s), expected 0)',
      v_occ_r_b, v_count;
  end if;
  v_checks := v_checks + 1;

  -- (e) BOTH tags now sit on the canonical occasion.
  select count(*) into v_count
    from wishlist_item_occasions
   where occasion_id = v_occ_r_a and item_id in (v_item_r_a, v_item_r_b);
  if v_count <> 2 then
    raise exception
      'RPC FAIL: canonical occasion % has % tag(s) after confirm, expected both items (%, %) tagged onto it',
      v_occ_r_a, v_count, v_item_r_a, v_item_r_b;
  end if;
  v_checks := v_checks + 1;

  -- (f) the old tag row naming the non-canonical occasion is gone (not left
  -- as a dangling duplicate).
  select count(*) into v_count
    from wishlist_item_occasions where item_id = v_item_r_b and occasion_id = v_occ_r_b;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: % leftover tag row(s) still name the deleted occasion %, expected 0',
      v_count, v_occ_r_b;
  end if;
  v_checks := v_checks + 1;

  -- (g) the claim is RE-POINTED to the canonical occasion, still active.
  select count(*) into v_count
    from wishlist_claims
   where id = v_claim_r and occasion_id = v_occ_r_a and released_at is null;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: claim % does not resolve to exactly 1 row pointing at the canonical occasion % with released_at null after confirm',
      v_claim_r, v_occ_r_a;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Fixture for assertion 8.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name) values
    (v_req_alice, 'annrpcreqalice', 'AnnRPC Req Alice'),
    (v_req_zoe,   'annrpcreqzoe',   'AnnRPC Req Zoe');

  insert into groups (name, type, invite_code, created_by)
    values ('AnnRPC Req Group', 'family', 'ANNRPCREQ', v_req_alice)
    returning id into v_group_req;

  -- add_group_creator_as_owner() already added v_req_alice. v_req_zoe joins
  -- too, sharing the group -- request_anniversary_link's shared-group guard
  -- needs this to succeed at all.
  insert into group_members (group_id, user_id, role)
    values (v_group_req, v_req_zoe, 'member')
    on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Assertion 8 (2 checks, closing the brief's gap -- see file header):
  -- request_anniversary_link, called by a co-member, succeeds and produces
  -- exactly one pending row with canonical ordering, the caller recorded as
  -- initiator, and the given date. v_req_zoe (lexicographically the LARGER
  -- id) is the caller and names v_req_alice (the smaller id) as the partner
  -- -- the reverse of canonical order -- so a correct result proves
  -- least()/greatest() actually reorders rather than trusting call order.
  --
  -- FALSIFIABLE: swap `least`/`greatest` in the RPC (or drop the reordering
  -- entirely and insert the parameters positionally) and check (a) fails --
  -- user_a would be v_req_zoe, tripping anniversary_links_canonical, which
  -- RAISES and would abort this file rather than merely fail an assertion,
  -- which is exactly why this must be checked live rather than left to the
  -- CHECK constraint. Swap `initiated_by = v_caller` for the partner
  -- parameter and check (a) fails too (initiated_by would read
  -- v_req_alice). NOT caught: request_anniversary_link succeeding via some
  -- OTHER, non-canonical storage shape that happens to satisfy this exact
  -- WHERE clause by coincidence -- check (b)'s total-row-count guards against
  -- a stray duplicate specifically, not against every possible alternate
  -- shape.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_req_zoe || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.request_anniversary_link(v_req_alice, '2012-12-12') into v_link_req;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from anniversary_links
   where id = v_link_req
     and user_a = v_req_alice and user_b = v_req_zoe
     and status = 'pending'
     and initiated_by = v_req_zoe
     and agreed_date = '2012-12-12';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: request_anniversary_link''s returned id % resolves to % row(s) matching canonical order (user_a=%, user_b=%), status=pending, initiated_by=%, agreed_date=2012-12-12 -- expected exactly 1',
      v_link_req, v_count, v_req_alice, v_req_zoe, v_req_zoe;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from anniversary_links where user_a = v_req_alice and user_b = v_req_zoe;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: % row(s) exist in anniversary_links for the canonical pair (%, %), expected exactly 1',
      v_count, v_req_alice, v_req_zoe;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9 (3 checks): request_anniversary_link's three guards --
  -- self-link, shared-group, date-validity -- each present, uncommented,
  -- line-anchored, tied to its own errcode. These all RAISE, and an uncaught
  -- raise aborts this file's batch, so they are anchored source checks
  -- rather than live calls (see file header).
  --
  -- FALSIFIABLE (each of the three): comment out that guard's `if` line, or
  -- change its raise message/errcode, and that guard's count drops to 0.
  -- NOT caught: the three guards being present but reordered relative to
  -- each other (guard ORDERING is out of scope -- reordering changes which
  -- message a caller tripping two guards at once sees, not whether the
  -- request is ultimately denied), or a guard whose condition was replaced
  -- by a functionally-different one that happens to keep the same `if`
  -- line's exact text while its raise fires on different inputs (an
  -- exact-text check cannot see behavioural drift, only textual absence).
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~ '(?n)^\s*if p_partner_id = v_caller then$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''you cannot share an anniversary with yourself''\n\s*using errcode = ''22023'';$';
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its self-link guard, uncommented, with its errcode intact (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*if not exists \(select 1 from public\.get_shared_groups\(v_caller, p_partner_id\)\) then$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''that person is not in any of your groups''\n\s*using errcode = ''22023'';$';
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its shared-group guard, uncommented, with its errcode intact (matched % definition(s), expected 1) -- this is the guard the brief specifically requires be enforced here, not only in the picker',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*if public\.celebration_date_in_year\($\n\s*p_date, extract\(year from current_date\)::integer\) is null then$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''that is not a usable date'' using errcode = ''22023'';$';
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its date-validity guard, uncommented, with its errcode intact (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10 (2 checks): confirm_anniversary_link's recipient guard --
  -- specifically the `v_caller = v_link.initiated_by` conjunct that stops
  -- the INITIATOR from confirming their own request. Also a raising path
  -- (aborts the whole `if v_link is null or ... then raise` on match), so
  -- anchored rather than live.
  --
  -- FALSIFIABLE: delete the `or v_caller = v_link.initiated_by` line (the
  -- exact residue this correction calls out) and check (a) drops to 0
  -- immediately, independent of check (b). NOT caught: reordering the three
  -- OR'd conditions relative to each other (their combination is
  -- commutative, so this would not change behaviour, and this file does not
  -- claim to check ordering).
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~ '(?n)^\s*or v_caller = v_link\.initiated_by$';
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link no longer contains its initiator-exclusion conjunct (v_caller = v_link.initiated_by), uncommented (matched % definition(s), expected 1) -- an initiator could confirm their own request',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''no anniversary request for you to confirm''\n\s*using errcode = ''22023'';$';
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link no longer raises its recipient-guard message with its errcode intact (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11 (3 checks): the members-table pre-check, the unconditional
  -- two-row insert (the race backstop), and the exception handler that
  -- translates a collision on that backstop to the SAME message the
  -- pre-check gives. This is the second correction's structural proof --
  -- tripping either path RAISES (a `unique_violation` or the pre-check's own
  -- raise), so, same reasoning as assertions 9-10, it cannot be exercised
  -- live in this file.
  --
  -- FALSIFIABLE: delete the pre-check's `if exists (...) then raise ...` block
  -- and check (a) drops to 0; change the insert to a single row, or to only
  -- one of the two user ids, and check (b) drops to 0 (a single-row insert
  -- would still create SOME row, but not one per partner, defeating the
  -- either-side invariant for the OTHER partner); delete the `when
  -- unique_violation` handler (or change its message so it no longer matches
  -- the pre-check's) and check (c) drops to 0 -- at that point a race would
  -- surface as a raw 23505 to the caller instead of the product-facing
  -- message. NOT caught: a handler present and correctly worded but that
  -- catches unique_violation too EARLY in execution order to actually wrap
  -- the anniversary_link_members insert (PL/pgSQL has exactly one
  -- EXCEPTION clause per block in this function, and it is the block's
  -- own -- so this residue does not apply to this function's actual shape,
  -- but would apply to a rewrite that split the body into nested blocks).
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*if exists \($'
        || E'\n' || '\s*select 1 from public\.anniversary_link_members$'
        || E'\n' || '\s*where user_id in \(v_link\.user_a, v_link\.user_b\)$'
        || E'\n' || '\s*\) then$'
        || E'\n' || '\s*raise exception ''one of you already shares an anniversary with somebody else'''
        || E'\n' || '\s*using errcode = ''22023'';$'
        || E'\n' || '\s*end if;$');
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link no longer contains its anniversary_link_members pre-check, uncommented, wired to its message and errcode (matched % definition(s), expected 1) -- the human-readable half of the either-side invariant would be gone',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*insert into public\.anniversary_link_members \(user_id, link_id\)$'
        || E'\n' || '\s*values \(v_link\.user_a, p_link_id\), \(v_link\.user_b, p_link_id\);$');
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link no longer inserts both partner rows into anniversary_link_members in one statement (matched % definition(s), expected 1) -- the race backstop would not be populated for both sides',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*when unique_violation then$'
        || E'\n' || '\s*raise exception ''one of you already shares an anniversary with somebody else'''
        || E'\n' || '\s*using errcode = ''22023'';$');
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link no longer translates a unique_violation on anniversary_link_members to the pre-check''s own message (matched % definition(s), expected 1) -- a race would surface as a raw constraint error instead',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12 (4 checks): the block-comment floor beneath every anchored
  -- pattern above, one check per function. Line-anchoring stops a `--` line
  -- comment (it moves where a line starts); it does nothing against a
  -- `/* ... */` block comment, which leaves every line byte-identical and
  -- merely brackets them -- and `\s` matches a literal newline in a POSIX
  -- ARE even under `(?n)`, since `n` constrains only `.` and a negated
  -- bracket expression. Scoped by the same exact ::regprocedure identity as
  -- every check above.
  --
  -- FALSIFIABLE: wrap any guard checked above in `/* ... */` and this file's
  -- corresponding function's check fails, because block_comment_pos would be
  -- nonzero -- exposing that every OTHER anchored check against that same
  -- function was unsound the moment this floor is violated. NOT caught: a
  -- block comment appearing AFTER every pattern this file checks but before
  -- the function's closing dollar-quote terminator -- position() reports the FIRST `/*`,
  -- and a comment located harmlessly at the very end (after all checked
  -- lines) would still trip this floor and correctly fail closed, so this
  -- has no false-negative residue in the direction that matters.
  ---------------------------------------------------------------------------
  select position('/*' in pg_get_functiondef(p.oid)) into v_block_comment_pos
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure;
  if v_block_comment_pos <> 0 then
    raise exception
      'GUARD FAIL: request_anniversary_link''s definition contains a /* block comment starting at character %, which would make every anchored check against it unsound',
      v_block_comment_pos;
  end if;
  v_checks := v_checks + 1;

  select position('/*' in pg_get_functiondef(p.oid)) into v_block_comment_pos
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure;
  if v_block_comment_pos <> 0 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link''s definition contains a /* block comment starting at character %, which would make every anchored check against it unsound',
      v_block_comment_pos;
  end if;
  v_checks := v_checks + 1;

  select position('/*' in pg_get_functiondef(p.oid)) into v_block_comment_pos
    from pg_proc p
   where p.oid = 'public.decline_anniversary_link(uuid)'::regprocedure;
  if v_block_comment_pos <> 0 then
    raise exception
      'GUARD FAIL: decline_anniversary_link''s definition contains a /* block comment starting at character %',
      v_block_comment_pos;
  end if;
  v_checks := v_checks + 1;

  select position('/*' in pg_get_functiondef(p.oid)) into v_block_comment_pos
    from pg_proc p
   where p.oid = 'public.unlink_anniversary(uuid)'::regprocedure;
  if v_block_comment_pos <> 0 then
    raise exception
      'GUARD FAIL: unlink_anniversary''s definition contains a /* block comment starting at character %',
      v_block_comment_pos;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 39 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 39', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_19_anniversary_link_rpcs');
end $$;

select token as result from _harness_result;
