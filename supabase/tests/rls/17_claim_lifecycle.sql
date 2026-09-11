-- claim_wishlist_item() / release_wishlist_claim() -- the two RPCs that own
-- every write to wishlist_claims (20260911100002_claim_rpcs.sql). Both are
-- SECURITY DEFINER, so this file is not testing a USING/WITH CHECK clause the
-- way 16_claim_visibility.sql does -- it is testing plpgsql control flow and
-- the unique-index backstop it relies on.
--
-- CORRECTION TO THE ORIGINAL BRIEF, recorded here because it changes the
-- shape of three of the seven assertions below. The brief's assertions 2, 4
-- and 7 each ask to "assert by row count" after an operation that must be
-- REFUSED. claim_wishlist_item() refuses by RAISING (a second claimer hits
-- the unique_violation handler; the owner hits an explicit raise; an
-- unviewable occasion hits an explicit raise) -- it does not filter rows the
-- way a SELECT's USING clause does. test-rls.sh sends this whole file as ONE
-- batch and bans `exception when` file-wide (scripts/test-rls.sh:276-279), so
-- an uncaught raise from any one of these three would abort every assertion
-- in this file, including the four that are perfectly safe to run live. This
-- is the same defect class 16_claim_visibility.sql's header documents for its
-- own would-be assertion 4, and 15_celebrated_materialization.sql's for its
-- assertion 3 -- confirmed there, and not re-derived here.
--
-- So assertions 2, 4 and 7 are each a LIVE, NON-RAISING check that the row
-- the guard would need to deny genuinely exists and is not blocked by
-- anything else first (so the check is not vacuous), plus an ANCHORED SOURCE
-- check against claim_wishlist_item's own pg_get_functiondef(), following the
-- corrected pattern 15_celebrated_materialization.sql reached after two
-- review rounds: every regex carries its OWN (?n), every pattern is
-- line-anchored (^\s*...$), and the pg_proc lookup is scoped by exact
-- ::regprocedure identity rather than proname, so an ungated overload cannot
-- satisfy the count. Every raise+errcode pair in this migration sits on ONE
-- line (unlike 20260911100000's split raise, which needed a \n-joined
-- two-line pattern), so a single anchored line ties the message and the
-- errcode together with no join needed at all.
--
-- BE HONEST about what this buys: assertions 2, 4 and 7 are now SHAPE checks
-- -- they prove the guard is present, uncommented, and wired to the right
-- variables, not that the raise actually fires end-to-end through the RPC.
-- Assertion 2 and 4 are backed by one additional live, non-raising check each
-- that exercises the same underlying mechanism a different way (see their
-- own comments below); assertion 7 additionally gets a full rolled-back
-- exploit demonstration, run as a standalone script outside this suite (see
-- the task report) -- it is the assertion the plan's pre-flight ruling added
-- specifically because an existence-only implementation of the occasion
-- guard passes every other assertion in this file.
--
-- Assertions 1, 3, 5 and 6 are unaffected -- 1/3/5 are success paths (no
-- raise reached), and 6 is the one denial path that returns FALSE instead of
-- raising, by explicit design (release_wishlist_claim's header: "an unclaim
-- that finds nothing is not an error").
--
-- Convention: see 00_harness_smoke.sql. Fixture writes (including the
-- pre-existing lapsed claim for assertion 3, and assertion 2's direct
-- ON CONFLICT probe -- there is no INSERT policy on wishlist_claims, and
-- `authenticated` holds no INSERT privilege on it either) happen while
-- impersonating the connecting (RLS-bypassing) role. RPC calls run as the
-- specific caller they are testing, so `role`/`request.jwt.claims` are
-- toggled around each one, and `role` is reset to the captured `current_user`
-- before every catalog read.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role        text;
  v_checks           int := 0;
  v_owner            text := 'user_claimrpc_owner';
  v_giver            text := 'user_claimrpc_giver';
  v_giver2           text := 'user_claimrpc_giver2';
  v_private          text := 'user_claimrpc_private';
  v_group            uuid;
  v_item1            uuid;
  v_item3            uuid;
  v_occasion_past    uuid;
  v_occasion_private uuid;
  v_result_id        uuid;
  v_result_bool      boolean;
  v_count            int;
  v_claimed_by       text;
  v_released_at      timestamptz;
  v_item_owner       text;
  v_purchased        boolean;
  v_can              boolean;
  v_priv_settings    jsonb;
  v_priv_rows        int;
  v_occ_rows         int;
  v_guard_defs       int;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_owner,   'claimrpcowner',   'ClaimRPC Owner'),
           (v_giver,   'claimrpcgiver',   'ClaimRPC Giver'),
           (v_giver2,  'claimrpcgiver2',  'ClaimRPC Giver2'),
           (v_private, 'claimrpcprivate', 'ClaimRPC Private');

  insert into groups (name, type, invite_code, created_by)
    values ('ClaimRPC Family', 'family', 'CLAIMRP1', v_owner)
    returning id into v_group;

  -- add_group_creator_as_owner() already added v_owner. v_giver and v_giver2
  -- join, sharing "family" with the owner; v_private stays out entirely --
  -- irrelevant either way, since assertion 7 denies on an EMPTY
  -- visibleToGroupTypes regardless of shared groups.
  insert into group_members (group_id, user_id, role)
    values (v_group, v_giver, 'member'),
           (v_group, v_giver2, 'member')
    on conflict do nothing;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'ClaimRPC Item One',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item1;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'ClaimRPC Item Three',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item3;

  -- (4a) Not-vacuous check for assertion 4, captured now while nothing has
  -- touched the row yet: item1 genuinely belongs to v_owner, so the
  -- ownership guard below is reached rather than short-circuited by a
  -- lookup that resolves to nobody.
  select user_id, purchased into v_item_owner, v_purchased
    from wishlist_items where id = v_item1;

  if v_item_owner is distinct from v_owner or v_purchased is distinct from false then
    raise exception
      'HARNESS FAIL: fixture item1 has owner=%, purchased=%, expected owner=% and purchased=false -- assertion 4''s ownership guard would not be the thing reached first',
      v_item_owner, v_purchased, v_owner;
  end if;
  v_checks := v_checks + 1;

  -- An occasion dated explicitly in the past -- not one that merely "happens"
  -- to have passed by the time this runs (Task 1 lost a review round to that
  -- exact fixture bug). Year 2000 is safely behind any date this suite will
  -- ever run on.
  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_owner, 'birthday', '2000-01-01'::date)
    returning id into v_occasion_past;

  -- v_private's occasion: exists in `occasions`, so an existence-only
  -- implementation of the visibility guard would wrongly admit it -- and its
  -- date is on file in profile_info with an EMPTY visibleToGroupTypes, so
  -- nobody outside v_private themselves can see it.
  insert into occasions (celebrant_id, kind, occasion_date)
    values (v_private, 'birthday', '2030-06-15'::date)
    returning id into v_occasion_private;

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_private, 'dates', 'birthday', '1985-03-03',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  -- (7b) Not-vacuous check for assertion 7: the occasion row really is on
  -- file with celebrant_id set -- the row an existence-only guard would find
  -- and wrongly accept.
  select count(*) into v_occ_rows
    from occasions where id = v_occasion_private and celebrant_id = v_private;

  if v_occ_rows <> 1 then
    raise exception
      'HARNESS FAIL: fixture occasion % for % resolves to % row(s), expected exactly 1 -- assertion 7 would be exercising "no such occasion" instead of "cannot see it"',
      v_occasion_private, v_private, v_occ_rows;
  end if;
  v_checks := v_checks + 1;

  -- Capture v_private's REAL stored privacy_settings now, before any
  -- impersonation, the same discipline 15_celebrated_materialization.sql
  -- uses for its own assertion 3(a).
  select privacy_settings into v_priv_settings
    from profile_info
   where user_id = v_private and category = 'dates' and field_name = 'birthday';

  -- (7b, continued) A second not-vacuous check: the occasion guard's own
  -- exists() subquery joins occasions to profile_info on (user_id, 'dates',
  -- kind::text) before it ever reaches can_view_field. This confirms that
  -- join genuinely finds a row too, so the denial assertion 7 relies on is
  -- provably about VISIBILITY, not about the join failing to match anything.
  select count(*) into v_priv_rows
    from profile_info
   where user_id = v_private and category = 'dates' and field_name = 'birthday';

  if v_priv_rows <> 1 then
    raise exception
      'HARNESS FAIL: fixture user % has % birthday row(s) in profile_info, expected exactly 1',
      v_private, v_priv_rows;
  end if;
  v_checks := v_checks + 1;

  -- The pre-existing, ACTIVE claim on item3, tied to the past occasion --
  -- written directly (no INSERT policy, and no INSERT privilege for
  -- `authenticated` either) so claim_wishlist_item()'s lapsed-release UPDATE
  -- has something to release before it inserts assertion 3's fresh claim.
  insert into wishlist_claims (item_id, occasion_id, claimed_by)
    values (v_item3, v_occasion_past, v_giver)
    returning id into v_result_id;

  ---------------------------------------------------------------------------
  -- Assertion 1 (2 checks): a co-member claims a visible item and exactly
  -- one active row results.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.claim_wishlist_item(v_item1, null) into v_result_id;

  select count(*) into v_count
    from wishlist_claims
   where id = v_result_id and item_id = v_item1 and claimed_by = v_giver
     and released_at is null;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: claim_wishlist_item returned id % which resolves to % matching row(s), expected exactly 1 active row for % on item %',
      v_result_id, v_count, v_giver, v_item1;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from wishlist_claims where item_id = v_item1 and released_at is null;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: item % has % active claim(s) after one claim, expected exactly 1',
      v_item1, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7(a) (1 check): live, non-raising proof that v_giver genuinely
  -- CANNOT see v_private's birthday -- not merely that some guard exists in
  -- source that might reference an unrelated pairing. Still impersonating
  -- v_giver, whose sub can_view_field's self-pin requires as the viewer_id
  -- argument.
  ---------------------------------------------------------------------------
  select public.can_view_field(v_private, v_giver, v_priv_settings) into v_can;

  if v_can is distinct from false then
    raise exception
      'HARNESS FAIL: can_view_field(%, %, ...) returned % for the empty-visibleToGroupTypes fixture, expected false -- assertion 7 would be checking a guard that never had anything to deny',
      v_private, v_giver, v_can;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2 (2 live checks + 1 anchored source check, the anchored one
  -- deferred to the catalog block below). Cannot call claim_wishlist_item a
  -- second time here -- the unique_violation handler re-raises "somebody has
  -- already claimed that item", which would abort this file (see header).
  --
  -- So the exclusion mechanism itself -- wishlist_claims_one_active, the race
  -- backstop the function's handler exists to translate -- is demonstrated
  -- directly and live: a raw INSERT with ON CONFLICT (item_id) WHERE
  -- released_at IS NULL DO NOTHING infers the exact same partial unique
  -- index, and never raises. This does NOT exercise claim_wishlist_item()'s
  -- own control flow (that is what the anchored check below is for) -- it
  -- proves the constraint the function relies on is real and live, as
  -- connecting-role fixture writes (no INSERT policy/privilege applies).
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  insert into wishlist_claims (item_id, occasion_id, claimed_by)
    values (v_item1, null, v_giver2)
  on conflict (item_id) where released_at is null do nothing;

  select count(*) into v_count
    from wishlist_claims where item_id = v_item1 and released_at is null;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: item % has % active claim(s) after a conflicting insert was attempted, expected exactly 1 -- wishlist_claims_one_active did not hold',
      v_item1, v_count;
  end if;
  v_checks := v_checks + 1;

  select claimed_by into v_claimed_by
    from wishlist_claims where item_id = v_item1 and released_at is null;

  if v_claimed_by is distinct from v_giver then
    raise exception
      'RLS FAIL: item %''s active claim is held by % after a conflicting insert by %, expected the original claimer % unchanged',
      v_item1, v_claimed_by, v_giver2, v_giver;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3 (3 checks): a claim whose occasion is in the past is
  -- released by a subsequent claim, and the new claim succeeds -- the
  -- self-healing path claim_wishlist_item exists for. Item3 already carries
  -- an ACTIVE claim (by v_giver, tied to v_occasion_past, dated 2000-01-01)
  -- from the fixture block above. v_giver2 claims it now.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver2 || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.claim_wishlist_item(v_item3, null) into v_result_id;

  select count(*) into v_count
    from wishlist_claims
   where id = v_result_id and item_id = v_item3 and claimed_by = v_giver2
     and released_at is null;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: self-healing claim on item % returned id % which resolves to % matching row(s), expected exactly 1',
      v_item3, v_result_id, v_count;
  end if;
  v_checks := v_checks + 1;

  select released_at into v_released_at
    from wishlist_claims where item_id = v_item3 and claimed_by = v_giver;

  if v_released_at is null then
    raise exception
      'RLS FAIL: item %''s lapsed claim (by %, tied to a past occasion) was not released when the new claim was made',
      v_item3, v_giver;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from wishlist_claims where item_id = v_item3 and released_at is null;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: item % has % active claim(s) after the self-healing claim, expected exactly 1',
      v_item3, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4(b) (1 check): live, non-raising proof that visibility is NOT
  -- what would block v_owner from claiming their own item -- isolating the
  -- ownership guard as the actual blocker (paired with 4a's ownership check
  -- above). can_view_wishlist_item's self-view early return makes this true
  -- unconditionally, but it has to be called as v_owner for the self-pin.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.can_view_wishlist_item(v_owner, v_owner,
    (select privacy_settings from wishlist_items where id = v_item1)) into v_can;

  if v_can is distinct from true then
    raise exception
      'HARNESS FAIL: can_view_wishlist_item(%, %, ...) returned % for a self-view, expected true -- assertion 4 would be measuring the visibility guard instead of the ownership guard',
      v_owner, v_owner, v_can;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5 (3 checks): release_wishlist_claim by the claimer sets
  -- released_at, and a fresh claim then succeeds. v_giver still holds the
  -- active claim on item1 from assertion 1 (assertion 2's conflicting
  -- insert above never landed).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.release_wishlist_claim(v_item1) into v_result_bool;

  if v_result_bool is distinct from true then
    raise exception
      'RLS FAIL: release_wishlist_claim(%) by claimer % returned %, expected true',
      v_item1, v_giver, v_result_bool;
  end if;
  v_checks := v_checks + 1;

  select released_at into v_released_at
    from wishlist_claims where item_id = v_item1 and claimed_by = v_giver;

  if v_released_at is null then
    raise exception
      'RLS FAIL: item %''s claim by % still has released_at IS NULL after release_wishlist_claim returned true',
      v_item1, v_giver;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver2 || '","role":"authenticated"}', true);

  select public.claim_wishlist_item(v_item1, null) into v_result_id;

  select count(*) into v_count
    from wishlist_claims
   where item_id = v_item1 and released_at is null and claimed_by = v_giver2;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: item % has % active claim(s) held by % after release-then-reclaim, expected exactly 1',
      v_item1, v_count, v_giver2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6 (2 checks): release_wishlist_claim by a DIFFERENT user (one
  -- who never held the claim) releases nothing -- returns false rather than
  -- raising, per release_wishlist_claim's own header. v_giver2 holds the
  -- active claim on item1 now (assertion 5); v_owner never claimed it.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);

  select public.release_wishlist_claim(v_item1) into v_result_bool;

  if v_result_bool is distinct from false then
    raise exception
      'RLS FAIL: release_wishlist_claim(%) by non-claimer % returned %, expected false',
      v_item1, v_owner, v_result_bool;
  end if;
  v_checks := v_checks + 1;

  select released_at into v_released_at
    from wishlist_claims where item_id = v_item1 and claimed_by = v_giver2;

  if v_released_at is not null then
    raise exception
      'RLS FAIL: item %''s active claim by % was released by a non-claimer''s call, expected it untouched',
      v_item1, v_giver2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Catalog block: back to the connecting role, as every sibling file in
  -- this suite does before its own pg_get_functiondef()/pg_policies reads.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);

  -- Assertion 2's anchored source check (1 check): the unique_violation
  -- handler is present, uncommented, and still raises the product-facing
  -- message with its errcode attached. Scoped by exact regprocedure
  -- identity, not proname, so an ungated overload cannot satisfy the count.
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.claim_wishlist_item(uuid, uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~ '(?n)^\s*when unique_violation then$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''somebody has already claimed that item'' using errcode = ''22023'';$';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: claim_wishlist_item no longer contains its unique_violation handler, uncommented, with its errcode intact (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  -- Assertion 4's anchored source check (1 check): the ownership guard.
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.claim_wishlist_item(uuid, uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~ '(?n)^\s*if v_owner = v_caller then$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''you cannot claim your own item'' using errcode = ''22023'';$';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: claim_wishlist_item no longer contains its ownership guard, uncommented, with its errcode intact (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  -- Assertion 7's anchored source check (1 check): the whole occasion
  -- visibility gate -- the `if` opening the exists(), BOTH arms of the
  -- union (celebrated via can_view_field, group_date via is_group_member,
  -- each in the exact (owner, viewer) / (group, user) argument order), and
  -- the final raise with its errcode. All four patterns required together,
  -- so a rewrite that drops one arm, or inverts one call's arguments, fails
  -- this count -- same technique 15_celebrated_materialization.sql's
  -- assertion 3(c) uses, extended from three patterns to four.
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.claim_wishlist_item(uuid, uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*if p_occasion_id is not null and not exists \($'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and public\.can_view_field\(o\.celebrant_id, v_caller, pi\.privacy_settings\)$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and public\.is_group_member\(o\.group_id, v_caller\)$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''that occasion is not available'' using errcode = ''22023'';$';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: claim_wishlist_item no longer contains its occasion visibility gate intact (both arms, correct argument order, errcode attached) -- matched % definition(s), expected 1',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 20 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 20', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_17_claim_lifecycle');
end $$;

select token as result from _harness_result;
