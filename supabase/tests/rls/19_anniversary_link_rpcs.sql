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
--
-- ROUND-1 REVIEW FIXES, all against 20260912000005_anniversary_link_rpc_
-- corrections.sql (which supersedes decline_anniversary_link and
-- unlink_anniversary from 20260912000003 -- see that migration's header for
-- the full reproduction and ruling):
--
--   CRITICAL: unlink_anniversary's occasion UPDATE was scoped only by
--   `celebrant_id = v_link.user_a`, with no `partner_id` check, so ANY link
--   naming a celebrant as its canonical id -- including one an unrelated
--   third party merely shares a GROUP with, entirely outside the real
--   couple -- could silently clear that couple's partner_id through granted
--   RPCs alone. Fixed by scoping to `and partner_id = v_link.user_b` too.
--   The new cross-link isolation assertion below constructs exactly this
--   shape and was confirmed failing against the unfixed function and
--   passing against the fixed one (task report has the transcript).
--
--   RULING: one function per status, both callable by EITHER participant.
--   decline_anniversary_link now accepts either participant on a PENDING
--   row (the initiator exclusion is dropped -- Task 9's UI lets the
--   initiator cancel); unlink_anniversary now only reaches CONFIRMED rows
--   (`and status = 'confirmed'`), which independently closes the
--   reproduction above at its root. Assertion 2 is rewritten to match, and
--   assertion 3's fixture moved from pending to confirmed so its
--   non-participant check still exercises the participant guard rather
--   than being satisfied by the status filter alone; a new sub-assertion
--   covers "unlink on a still-pending row returns false" as its own
--   dedicated regression guard for the status filter specifically.
--
--   MINOR: assertions 9 and 10 now match each guard's condition and its
--   raise as ONE contiguous multi-line pattern (matching assertion 11's
--   style already), rather than ANDing two independent regexes that could
--   each match while disassociated from each other.
--
--   MINOR: assertion 4's fixture-1 comment claimed anniversary_link_members
--   cascades on unlink; a check reading that table after unlink now backs
--   the claim.
--
-- ROUND-2 REVIEW FIXES, for Task 5's own round-1 fix
-- (20260912000012_confirm_link_reconciles_both_dates.sql), which made
-- confirm_anniversary_link adopt the agreed anniversary date for BOTH
-- partners instead of only the confirmer:
--
--   IMPORTANT: nothing in this file (or anywhere else) checked the
--   INITIATOR's profile_info row after a confirm -- assertions 5 and 6 both
--   check only the RECIPIENT's. Reverting 20260912000012 entirely (back to
--   20260912000003's original body, writing only `v_caller`) left this
--   file's gate fully green regardless. New assertion 6b closes that,
--   reusing assertions 5/6's own fixtures and confirm calls -- no new
--   fixture needed, since both v_c5_a and v_c6_a (the initiators) already
--   have zero prior profile_info anniversary rows, so this exercises the
--   INSERT branch of the ON CONFLICT for the initiator specifically.
--
--   IMPORTANT: 20260912000012 reconciled profile_info (the LISTING's
--   source) but left an already-MATERIALIZED occasion's own occasion_date
--   untouched -- a claim's lapse check keys off THAT column, not the
--   listing, so the two could drift out of sync the moment a canonical
--   partner's anniversary was materialized before the confirm. Assertion
--   7's own fixture already has exactly the right shape (both partners
--   pre-materialized in the same year); its `agreed_date` is changed from
--   matching v_occ_r_a's own pre-existing date to a genuinely different one
--   ('2026-07-04', still the same year, so occasion_year cannot collide),
--   and a new check (c3) confirms occasion_date is re-derived to that
--   value, not left stale. Fixed by
--   20260912000014_confirm_link_reconciles_occasion_date.sql (live body).

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
  v_occ_date          date;
  v_block_comment_pos int;
  v_guard_defs        int;

  -- assertion 1: decline by the recipient
  v_d1_a   text := 'user_annrpc_d1_a';
  v_d1_b   text := 'user_annrpc_d1_b';
  v_link_d1 uuid;

  -- assertion 2: decline by the initiator (now succeeds -- see ruling), plus
  -- a separate fixture for decline by a non-participant (still denied).
  v_d2_a   text := 'user_annrpc_d2_a';
  v_d2_b   text := 'user_annrpc_d2_b';
  v_link_d2 uuid;

  v_d2n_a   text := 'user_annrpc_d2n_a';
  v_d2n_b   text := 'user_annrpc_d2n_b';
  v_d2n_out text := 'user_annrpc_d2n_out';
  v_link_d2n uuid;

  -- assertion 3: unlink by a non-participant on a CONFIRMED link, plus
  -- unlink attempted on a still-PENDING link (must return false -- that is
  -- decline's job now, not unlink's).
  v_u3_a   text := 'user_annrpc_u3_a';
  v_u3_b   text := 'user_annrpc_u3_b';
  v_u3_out text := 'user_annrpc_u3_out';
  v_link_u3 uuid;

  v_u3p_a  text := 'user_annrpc_u3p_a';
  v_u3p_b  text := 'user_annrpc_u3p_b';
  v_link_u3p uuid;

  -- assertion 4: unlink by either partner (two fixtures, opposite sides)
  v_u4_a    text := 'user_annrpc_u4_a';
  v_u4_b    text := 'user_annrpc_u4_b';
  v_link_u4 uuid;
  v_occ_u4  uuid;
  v_item_u4 uuid;

  v_u4c_a    text := 'user_annrpc_u4c_a';
  v_u4c_b    text := 'user_annrpc_u4c_b';
  v_link_u4c uuid;

  -- cross-link isolation (Critical 2): a CONFIRMED couple (x_a, x_b) and a
  -- separate PENDING link sharing x_a with a third person x_c. x_a is
  -- deliberately the lexicographically smaller id in BOTH links (see the
  -- fixture comment below), matching the exact shape the reviewer's
  -- reproduction used.
  v_x_a    text := 'user_annrpc_x_a';
  v_x_b    text := 'user_annrpc_x_b';
  v_x_c    text := 'user_annrpc_x_c';
  v_link_x_confirmed uuid;
  v_link_x_pending   uuid;
  v_occ_x  uuid;

  -- assertion 4c: isolates the partner_id conjunct itself, via a SYNTHETIC
  -- occasion row no authenticated-reachable path can produce (same
  -- technique as 16_claim_visibility.sql's owner-blindness fixture). y_a is
  -- confirmed-linked to y_b; a SEPARATE occasion also names y_a as celebrant
  -- but carries partner_id = y_z, a person y_a has no link with at all.
  v_y_a     text := 'user_annrpc_y_a';
  v_y_b     text := 'user_annrpc_y_b';
  v_y_z     text := 'user_annrpc_y_z';
  v_link_y  uuid;
  v_occ_y_real uuid;
  v_occ_y_synthetic uuid;

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
    (v_d2n_a,   'annrpcd2na',   'AnnRPC D2N A'),
    (v_d2n_b,   'annrpcd2nb',   'AnnRPC D2N B'),
    (v_d2n_out, 'annrpcd2nout', 'AnnRPC D2N Outsider'),
    (v_u3_a,   'annrpcu3a',   'AnnRPC U3 A'),
    (v_u3_b,   'annrpcu3b',   'AnnRPC U3 B'),
    (v_u3_out, 'annrpcu3out', 'AnnRPC U3 Outsider'),
    (v_u3p_a,  'annrpcu3pa',  'AnnRPC U3P A'),
    (v_u3p_b,  'annrpcu3pb',  'AnnRPC U3P B'),
    (v_u4_a,   'annrpcu4a',   'AnnRPC U4 A'),
    (v_u4_b,   'annrpcu4b',   'AnnRPC U4 B'),
    (v_u4c_a,  'annrpcu4ca',  'AnnRPC U4C A'),
    (v_u4c_b,  'annrpcu4cb',  'AnnRPC U4C B'),
    (v_x_a,    'annrpcxa',    'AnnRPC X A'),
    (v_x_b,    'annrpcxb',    'AnnRPC X B'),
    (v_x_c,    'annrpcxc',    'AnnRPC X C'),
    (v_y_a,    'annrpcya',    'AnnRPC Y A'),
    (v_y_b,    'annrpcyb',    'AnnRPC Y B'),
    (v_y_z,    'annrpcyz',    'AnnRPC Y Z');

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_d1_a, v_d1_b, 'pending', v_d1_a, '2011-01-01')
    returning id into v_link_d1;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_d2_a, v_d2_b, 'pending', v_d2_a, '2012-02-02')
    returning id into v_link_d2;

  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_d2n_a, v_d2n_b, 'pending', v_d2n_a, '2012-03-03')
    returning id into v_link_d2n;

  -- assertion 3's non-participant fixture is now a CONFIRMED link (with its
  -- membership rows), not pending -- unlink_anniversary no longer reaches a
  -- pending row at all (see the ruling above), so a pending fixture here
  -- would make the non-participant check pass for the wrong reason (the
  -- status filter, not the participant guard).
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_u3_a, v_u3_b, 'confirmed', v_u3_a, '2013-03-03', now())
    returning id into v_link_u3;

  insert into anniversary_link_members (user_id, link_id)
    values (v_u3_a, v_link_u3), (v_u3_b, v_link_u3);

  -- assertion 3's second fixture: a genuinely PENDING link, to prove unlink
  -- returns false on it (decline_anniversary_link is what handles pending
  -- rows now).
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_u3p_a, v_u3p_b, 'pending', v_u3p_a, '2013-04-04')
    returning id into v_link_u3p;

  -- assertion 4, fixture 1: a genuinely CONFIRMED link with a real occasion,
  -- partner_id set, and one tag -- so "leaves the occasion and its tags in
  -- place" is checked against something that actually exists, not an absence
  -- that would pass regardless. Inserted directly (status='confirmed') along
  -- with its anniversary_link_members rows: unlink_anniversary never writes
  -- to that table directly, but deleting the link must cascade-clear it, and
  -- the FK's ON DELETE CASCADE is what this fixture proves against below.
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

  -- Cross-link isolation fixture (Critical 2): a CONFIRMED couple (x_a, x_b)
  -- with a real, partner-carrying occasion, and a SEPARATE PENDING link
  -- naming x_a and a third person x_c. x_a is lexicographically the smaller
  -- id in BOTH pairs (annrpc_x_a < annrpc_x_b and < annrpc_x_c), so both
  -- links resolve to the SAME v_link.user_a -- exactly the shape that let an
  -- unrelated pending link's unlink call reach and clear the real couple's
  -- occasion before this round's fix.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_x_a, v_x_b, 'confirmed', v_x_a, '2022-07-07', now())
    returning id into v_link_x_confirmed;

  insert into anniversary_link_members (user_id, link_id)
    values (v_x_a, v_link_x_confirmed), (v_x_b, v_link_x_confirmed);

  insert into occasions (celebrant_id, partner_id, kind, occasion_date)
    values (v_x_a, v_x_b, 'anniversary', '2026-07-07')
    returning id into v_occ_x;

  -- x_c shares nothing with the x_a/x_b couple beyond having asked x_a for a
  -- link of their own -- never confirmed, so x_a never agreed to it.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_x_a, v_x_c, 'pending', v_x_c, '2023-08-08')
    returning id into v_link_x_pending;

  -- Fixture for assertion 4c: isolates the `and partner_id = v_link.user_b`
  -- conjunct on its own, independent of the status filter. y_a is
  -- confirmed-linked to y_b (real occasion, year 2026). A SECOND occasion --
  -- a DIFFERENT year, so occasions_celebrant_identity does not collide --
  -- also names y_a as celebrant but carries partner_id = y_z, a person y_a
  -- has no anniversary_links row with at all.
  --
  -- This second row is a SYNTHETIC state: no authenticated-reachable path
  -- can produce it. occasions.partner_id is set only by confirm_anniversary_
  -- link's own final UPDATE, scoped to `celebrant_id = v_link.user_a` for
  -- the CALLER's own just-confirmed link, and anniversary_link_members'
  -- primary key means y_a can hold at most one CONFIRMED link at a time --
  -- so y_a's occasion(s) can only ever carry a partner_id matching whoever
  -- y_a is (or was) actually confirmed-linked to, never an arbitrary third
  -- party. Written directly as the connecting role for exactly that reason
  -- -- the same precedent 16_claim_visibility.sql's owner-blindness fixture
  -- follows for a row no application path can produce.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date, confirmed_at)
    values (v_y_a, v_y_b, 'confirmed', v_y_a, '2024-09-09', now())
    returning id into v_link_y;

  insert into anniversary_link_members (user_id, link_id)
    values (v_y_a, v_link_y), (v_y_b, v_link_y);

  insert into occasions (celebrant_id, partner_id, kind, occasion_date)
    values (v_y_a, v_y_b, 'anniversary', '2026-09-09')
    returning id into v_occ_y_real;

  insert into occasions (celebrant_id, partner_id, kind, occasion_date)
    values (v_y_a, v_y_z, 'anniversary', '2027-09-09')
    returning id into v_occ_y_synthetic;

  ---------------------------------------------------------------------------
  -- Assertion 1 (2 checks): decline_anniversary_link by the RECIPIENT
  -- returns true, and the row is gone.
  --
  -- FALSIFIABLE: narrow `v_caller in (user_a, user_b)` to exclude the
  -- recipient specifically (or require `v_caller = initiated_by`, the
  -- opposite of the current rule) and this fails -- the recipient could no
  -- longer decline their own incoming request. NOT caught: reordering
  -- decline's other predicates, or a message-text change on an unrelated
  -- raise.
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
  -- Assertion 2 (4 checks): RULING (see file header and 20260912000005's
  -- migration header) -- either participant may remove a PENDING link, so
  -- decline_anniversary_link by the INITIATOR now also returns true and
  -- deletes the row (2a); a NON-PARTICIPANT is still denied, returns false,
  -- and the row survives, still pending (2b) -- that half is what was
  -- actually protecting anything, and it is kept.
  --
  -- FALSIFIABLE (2a): reintroduce an initiator exclusion (e.g.
  -- `initiated_by <> v_caller`) and this fails -- Task 9's UI lets the
  -- initiator cancel a pending request, so this must succeed. NOT caught:
  -- an initiator-decline that raises instead of returning true.
  -- FALSIFIABLE (2b): drop `v_caller in (user_a, user_b)` (return true for
  -- anyone) and this fails -- any authenticated caller could delete any
  -- pending link. NOT caught: a non-participant call that raises instead of
  -- returning false.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_d2_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.decline_anniversary_link(v_link_d2) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from true then
    raise exception
      'RPC FAIL: decline_anniversary_link by the initiator % returned %, expected true -- either participant may cancel a pending link',
      v_d2_a, v_bool;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_d2;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: anniversary_links still has % row(s) for id % after the initiator declined, expected 0',
      v_count, v_link_d2;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_d2n_out || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.decline_anniversary_link(v_link_d2n) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from false then
    raise exception
      'RPC FAIL: decline_anniversary_link by non-participant % returned %, expected false',
      v_d2n_out, v_bool;
  end if;
  v_checks := v_checks + 1;

  select status into v_status from anniversary_links where id = v_link_d2n;
  if v_status is distinct from 'pending' then
    raise exception
      'RPC FAIL: anniversary_links row % has status % after a denied decline by a non-participant, expected it untouched at pending',
      v_link_d2n, v_status;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3 (4 checks): (3a) unlink_anniversary by a NON-PARTICIPANT on
  -- a CONFIRMED link returns false and the row survives; (3b) unlink on a
  -- still-PENDING link -- by an actual participant, so only the status
  -- filter is in play -- also returns false, with the row untouched. (3a)'s
  -- fixture is deliberately CONFIRMED (not pending, per the ruling): a
  -- pending fixture there would make the non-participant check pass because
  -- of the status filter alone, not because the participant guard fired.
  --
  -- FALSIFIABLE (3a): drop the `v_caller not in (...)` guard (return false
  -- only when v_link is null) and this fails -- any authenticated caller
  -- could unlink any confirmed pair. NOT caught: a non-participant call
  -- that raises instead of returning false.
  -- FALSIFIABLE (3b): drop the `status = 'confirmed'` filter from the
  -- SELECT and this fails -- a pending link's own participant could remove
  -- it via unlink_anniversary again, bypassing decline_anniversary_link
  -- entirely (the exact sibling-RPC bypass the ruling closes). NOT caught:
  -- a version that still filters on status but uses the wrong literal
  -- (e.g. checks for anything other than 'confirmed') -- that would also
  -- fail 3b, but this file does not separately pin the literal's spelling.
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

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_u3p_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.unlink_anniversary(v_link_u3p) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from false then
    raise exception
      'RPC FAIL: unlink_anniversary on a still-pending link, called by participant %, returned %, expected false -- unlink_anniversary must only reach CONFIRMED links',
      v_u3p_a, v_bool;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_u3p;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: anniversary_links has % row(s) for the pending link % after a denied unlink attempt, expected 1 (untouched)',
      v_count, v_link_u3p;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4 (7 checks): unlink_anniversary by EITHER partner returns
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

  -- Minor fix: this fixture's own comment claims anniversary_link_members
  -- cascades away when the link is deleted -- back that claim with a check.
  select count(*) into v_count
    from anniversary_link_members where link_id = v_link_u4;
  if v_count <> 0 then
    raise exception
      'RPC FAIL: anniversary_link_members still has % row(s) for deleted link %, expected 0 -- the FK''s ON DELETE CASCADE should have cleared both membership rows',
      v_count, v_link_u4;
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
  -- Assertion 4b (4 checks): end-to-end reproduction of the reviewer's
  -- ORIGINAL exploit shape. x_c -- who shares nothing with the x_a/x_b
  -- couple beyond a pending link naming x_a -- calls unlink_anniversary on
  -- THAT pending link. Confirmed against both versions live (see the task
  -- report): fails against the fully unfixed function (occ_x clears to NULL
  -- despite x_c never being part of the x_a/x_b link) and passes against
  -- the fixed one.
  --
  -- CORRECTED (round 2 review): the FALSIFIABLE claim this comment
  -- previously made -- "remove the `and partner_id = v_link.user_b`
  -- conjunct ... and check (b) fails" -- is false, and was shown false by
  -- mutation: with `status = 'confirmed'` still in place, unlink_anniversary
  -- returns false on this PENDING link before ever reaching the occasion
  -- UPDATE, so removing the partner_id conjunct alone changes nothing this
  -- assertion observes. What checks (a)-(d) below actually establish is
  -- narrower: the reproduction fails end-to-end when EITHER the whole
  -- unlink_anniversary fix is reverted, OR the status filter alone is
  -- reverted (which puts the pending link back within unlink's reach) --
  -- they duplicate assertion 3's pending-link check (19:489-ish) for that
  -- second case rather than adding independent coverage of it. They do NOT
  -- isolate the partner_id conjunct while the status filter is intact,
  -- because no ordinary (authenticated-reachable) fixture can put the
  -- conjunct in play without ALSO satisfying the status filter, at which
  -- point the real bug it guards against needs a synthetic state to reach
  -- at all -- see assertion 4c immediately below, which is what actually
  -- isolates it.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_x_c || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.unlink_anniversary(v_link_x_pending) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from false then
    raise exception
      'RPC FAIL: unlink_anniversary on the unrelated pending link % (called by %) returned %, expected false -- it is still pending, not confirmed',
      v_link_x_pending, v_x_c, v_bool;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from occasions where id = v_occ_x and partner_id = v_x_b;
  if v_count <> 1 then
    raise exception
      'CRITICAL FAIL: the x_a/x_b couple''s occasion % lost partner_id=% after an unrelated pending link (%, sharing only x_a) was unlinked by a third party -- this is the cross-user corruption 20260912000005 fixes',
      v_occ_x, v_x_b, v_link_x_pending;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_x_confirmed and status = 'confirmed';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: the x_a/x_b confirmed link % does not resolve to exactly 1 confirmed row after the unrelated pending unlink, expected it entirely untouched',
      v_link_x_confirmed;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count from anniversary_links where id = v_link_x_pending;
  if v_count <> 1 then
    raise exception
      'RPC FAIL: the unrelated pending link % is gone after a denied unlink attempt, expected 1 (untouched)',
      v_link_x_pending;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4c (3 checks, ROUND 2 FIX): isolates the
  -- `and partner_id = v_link.user_b` conjunct itself, independent of the
  -- status filter -- what assertion 4b's comment previously, and wrongly,
  -- claimed to do. y_b (an actual participant of the CONFIRMED y_a/y_b
  -- link) calls unlink_anniversary on that real link, so the status filter
  -- is satisfied and the occasion UPDATE is genuinely reached this time.
  --
  -- Without the conjunct, the UPDATE's WHERE clause would read only
  -- `celebrant_id = v_link.user_a` (y_a), matching BOTH of y_a's occasion
  -- rows -- the real one (partner_id = y_b) AND the synthetic one
  -- (partner_id = y_z) -- and clear partner_id on both. WITH the conjunct,
  -- only the row where partner_id ALSO equals v_link.user_b (y_b) matches,
  -- so the synthetic row is untouched.
  --
  -- FALSIFIABLE: remove the `and partner_id = v_link.user_b` conjunct (the
  -- one actual regression this checks) and check (c) fails -- the synthetic
  -- row's partner_id (y_z) is cleared to NULL alongside the real one, since
  -- both share celebrant_id = y_a. NOT caught: a version that replaces the
  -- conjunct with some OTHER condition that happens to also exclude the
  -- synthetic row for an unrelated reason (e.g. `partner_id is not null`,
  -- which is true for both rows here and would not distinguish them) --
  -- this checks the OUTCOME (the synthetic row survives), not the literal
  -- WHERE clause text.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_y_b || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.unlink_anniversary(v_link_y) into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from true then
    raise exception
      'RPC FAIL: unlink_anniversary by participant % on the real confirmed link returned %, expected true',
      v_y_b, v_bool;
  end if;
  v_checks := v_checks + 1;

  -- (b) not-vacuous: the REAL occasion's partner_id is correctly cleared --
  -- proves the UPDATE genuinely ran and matched the intended row, so
  -- check (c) below is not passing merely because the UPDATE never fired
  -- at all.
  select count(*) into v_count
    from occasions where id = v_occ_y_real and partner_id is null;
  if v_count <> 1 then
    raise exception
      'HARNESS FAIL: the real occasion % does not have partner_id cleared after unlink (% matching row(s), expected 1) -- assertion 4c''s conjunct isolation would be vacuous if the UPDATE never ran',
      v_occ_y_real, v_count;
  end if;
  v_checks := v_checks + 1;

  -- (c) THE ISOLATION: the SYNTHETIC occasion, sharing celebrant_id = y_a
  -- but carrying a DIFFERENT partner_id (y_z), must be completely untouched.
  select count(*) into v_count
    from occasions where id = v_occ_y_synthetic and partner_id = v_y_z;
  if v_count <> 1 then
    raise exception
      'CRITICAL FAIL: synthetic occasion % (celebrant %, unrelated partner %) had its partner_id changed by an unlink call on a DIFFERENT link that only shares the same celebrant -- the partner_id conjunct is not doing its job',
      v_occ_y_synthetic, v_y_a, v_y_z;
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
  -- Assertion 6b (2 checks, round-2 review, IMPORTANT regression guard).
  -- Assertions 5 and 6 above check only the RECIPIENT's (v_c5_b / v_c6_b)
  -- profile_info row after confirm -- neither checks the INITIATOR's
  -- (v_c5_a / v_c6_a). 20260912000012_confirm_link_reconciles_both_
  -- dates.sql's whole point is that BOTH partners' dates agree afterwards,
  -- not only the confirmer's -- reverting that migration entirely (back to
  -- 20260912000003's original body, which writes only `v_caller`) left
  -- this file's gate fully green, since nothing here ever looked at the
  -- initiator's side. Neither v_c5_a nor v_c6_a has any prior profile_info
  -- anniversary row in this file's fixture (see the fixture comment above),
  -- so this exercises the INSERT branch of the ON CONFLICT for the
  -- initiator specifically -- the complement of what assertion 5 already
  -- proved for the recipient's OVERWRITE branch.
  --
  -- FALSIFIABLE: reverting confirm_anniversary_link's date-adoption insert
  -- to write only `v_caller` (20260912000003's original shape, or
  -- equivalently deleting `v_link.user_a`/`v_link.user_b` from the VALUES
  -- list and writing a single `v_caller` row instead) makes BOTH checks
  -- below fail: v_c5_a and v_c6_a would each have ZERO profile_info
  -- anniversary rows, not one, since confirm only ever ran as the
  -- RECIPIENT (v_c5_b / v_c6_b) in both fixtures -- verified by mutation
  -- against a scratch copy, see the task report. NOT caught: a write that
  -- reaches the initiator's row but with the WRONG value -- this checks
  -- field_value = the fixture's own agreed_date explicitly, so that is
  -- caught too.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from profile_info
   where user_id = v_c5_a and category = 'dates' and field_name = 'anniversary'
     and field_value = '2015-05-05';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: initiator % has % profile_info anniversary row(s) reading 2015-05-05 after confirm, expected exactly 1 -- confirm_anniversary_link must adopt the agreed date for BOTH partners, not only the confirmer',
      v_c5_a, v_count;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from profile_info
   where user_id = v_c6_a and category = 'dates' and field_name = 'anniversary'
     and field_value = '2018-08-08';
  if v_count <> 1 then
    raise exception
      'RPC FAIL: initiator % has % profile_info anniversary row(s) reading 2018-08-08 after confirm, expected exactly 1 -- confirm_anniversary_link must adopt the agreed date for BOTH partners, not only the confirmer',
      v_c6_a, v_count;
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

  -- agreed_date is DELIBERATELY '2026-07-04' -- neither v_occ_r_a's
  -- ('2026-06-15') nor v_occ_r_b's ('2026-09-20') existing occasion_date --
  -- so check (c3) below (round-2 review) proves occasion_date is genuinely
  -- RE-DERIVED from the newly-agreed value, not left at whichever of the
  -- two pre-existing dates happened to survive the reconciliation.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_r_a, v_r_b, 'pending', v_r_a, '2026-07-04')
    returning id into v_link_r;

  ---------------------------------------------------------------------------
  -- Assertion 7 (9 checks): reconciliation. Not-vacuous checks first (the
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

  -- (c3, round-2 review, IMPORTANT regression guard): the SAME canonical
  -- occasion's occasion_date is RE-DERIVED to the newly-agreed date
  -- ('2026-07-04'), not left at v_occ_r_a's stale pre-existing value
  -- ('2026-06-15'). 20260912000012_confirm_link_reconciles_both_dates.sql
  -- fixed profile_info (the LISTING's source) but left an already-
  -- MATERIALIZED occasion's occasion_date untouched -- exactly the gap
  -- claim_wishlist_item's lapse check (`occasion_date < current_date`)
  -- depends on staying in sync with what the listing shows, per the task
  -- report. Fixed in
  -- 20260912000014_confirm_link_reconciles_occasion_date.sql (live body).
  --
  -- FALSIFIABLE: reverting to 20260912000012's reconciliation UPDATE
  -- (`set partner_id = v_link.user_b` alone, no `occasion_date` conjunct)
  -- makes this fail: the canonical occasion keeps its stale '2026-06-15'
  -- instead of adopting '2026-07-04' -- verified by mutation against a
  -- scratch copy, see the task report. NOT caught: a re-derivation that
  -- lands on the WRONG date entirely (this checks the exact expected
  -- value, so that would already be caught) or one that changes
  -- occasion_year in the process (out of scope here -- this fixture's
  -- agreed_date stays within the same calendar year as the existing row,
  -- deliberately, so this check alone does not exercise a year-crossing
  -- re-derivation).
  select occasion_date into v_occ_date from occasions where id = v_occ_r_a;
  if v_occ_date is distinct from '2026-07-04' then
    raise exception
      'RPC FAIL: canonical occasion % has occasion_date % after confirm, expected 2026-07-04 -- confirm_anniversary_link must re-derive an already-materialized occasion''s date from the newly-agreed value, not leave it stale',
      v_occ_r_a, v_occ_date;
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
  -- MINOR FIX (round 1 review): each guard is now matched as ONE contiguous
  -- multi-line pattern (condition through `end if;`), not two independently
  -- ANDed regexes. Two independent regexes can each match while
  -- disassociated from each other -- e.g. the condition line surviving
  -- somewhere while its `raise` was moved elsewhere entirely -- and a
  -- contiguous pattern closes exactly that gap, the same way assertion 11
  -- already did. Confirmed contiguous patterns still match today for all
  -- three guards here and the one in assertion 10.
  --
  -- FALSIFIABLE (each of the three): comment out that guard's `if` line, its
  -- `raise`, or its `end if;`, or disassociate the condition from its raise
  -- (e.g. move the raise outside the if-block), and that guard's count drops
  -- to 0. NOT caught: the three guards being present but reordered relative
  -- to each other (guard ORDERING is out of scope -- reordering changes
  -- which message a caller tripping two guards at once sees, not whether
  -- the request is ultimately denied), or a guard whose condition was
  -- replaced by a functionally-different one that happens to keep the same
  -- exact text while firing on different inputs (an exact-text check cannot
  -- see behavioural drift, only textual absence/disassociation).
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*if p_partner_id = v_caller then$'
        || E'\n' || '\s*raise exception ''you cannot share an anniversary with yourself'''
        || E'\n' || '\s*using errcode = ''22023'';$'
        || E'\n' || '\s*end if;$');
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its self-link guard, uncommented, with its errcode intact and wired to its own end if (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*if not exists \(select 1 from public\.get_shared_groups\(v_caller, p_partner_id\)\) then$'
        || E'\n' || '\s*raise exception ''that person is not in any of your groups'''
        || E'\n' || '\s*using errcode = ''22023'';$'
        || E'\n' || '\s*end if;$');
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its shared-group guard, uncommented, with its errcode intact and wired to its own end if (matched % definition(s), expected 1) -- this is the guard the brief specifically requires be enforced here, not only in the picker',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.request_anniversary_link(text, text)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*if public\.celebration_date_in_year\($'
        || E'\n' || '\s*p_date, extract\(year from current_date\)::integer\) is null then$'
        || E'\n' || '\s*raise exception ''that is not a usable date'' using errcode = ''22023'';$'
        || E'\n' || '\s*end if;$');
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: request_anniversary_link no longer contains its date-validity guard, uncommented, with its errcode intact and wired to its own end if (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10 (1 check): confirm_anniversary_link's recipient guard,
  -- matched as ONE contiguous pattern from `if v_link is null` through its
  -- `end if;` -- specifically covering the `v_caller = v_link.initiated_by`
  -- conjunct that stops the INITIATOR from confirming their own request.
  -- Also a raising path (aborts the whole `if v_link is null or ... then
  -- raise` on match), so anchored rather than live.
  --
  -- MINOR FIX (round 1 review): previously two independently ANDed regexes
  -- (the `or v_caller = v_link.initiated_by` line, and the raise+errcode),
  -- which could each match while disassociated from each other. Merged into
  -- one contiguous pattern, same fix as assertion 9.
  --
  -- FALSIFIABLE: delete the `or v_caller = v_link.initiated_by` line (the
  -- exact residue this correction calls out), or disassociate it from the
  -- raise that follows, and this fails. NOT caught: reordering the three
  -- OR'd conditions relative to each other (their combination is
  -- commutative, so this would not change behaviour, and this file does not
  -- claim to check ordering).
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.confirm_anniversary_link(uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       ('(?n)^\s*if v_link is null$'
        || E'\n' || '\s*or v_caller not in \(v_link\.user_a, v_link\.user_b\)$'
        || E'\n' || '\s*or v_caller = v_link\.initiated_by$'
        || E'\n' || '\s*then$'
        || E'\n' || '\s*raise exception ''no anniversary request for you to confirm'''
        || E'\n' || '\s*using errcode = ''22023'';$'
        || E'\n' || '\s*end if;$');
  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: confirm_anniversary_link no longer contains its recipient guard (including the v_caller = v_link.initiated_by conjunct), uncommented, wired to its message, errcode and end if (matched % definition(s), expected 1) -- an initiator could confirm their own request',
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

  if v_checks < 53 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 53', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_19_anniversary_link_rpcs');
end $$;

select token as result from _harness_result;
