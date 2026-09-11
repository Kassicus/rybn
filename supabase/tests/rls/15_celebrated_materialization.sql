-- get_or_create_celebrated_occasion() must materialize SOMEBODY ELSE's
-- occasion only when the caller can actually see that person's date, must do
-- so idempotently, must stamp celebrant_id/created_by the right way round,
-- and must never create a row for a caller the privacy model would hide the
-- date from.
--
-- WHY ASSERTION 3 IS NOT "ATTEMPT THE CALL, THEN COUNT ROWS IN occasions".
--
-- That is what the words "creates no row" suggest, and it is the first thing
-- tried. It cannot work in this harness, and this was confirmed directly
-- against this project before writing the check below, the same way
-- 13_occasion_materialization.sql confirmed its own limitation:
--
--   begin;
--   do $$ begin raise exception 'probe failure'; end $$;
--   select 'after do block, should not appear' as marker;
--   rollback;
--
--   -> {"_tag":"Error", ... "ERROR:  P0001: probe failure"} -- the marker
--   SELECT never ran. One uncaught RAISE, anywhere in the do-block, ends the
--   whole batch this file is sent as (test-rls.sh sends the entire file as
--   ONE `supabase db query` string) -- there is no statement after it, in
--   this block or after it, that still executes. get_or_create_celebrated_
--   occasion's denial path is exactly this: an unconditional RAISE, not a
--   graceful NULL return (see the migration's header -- both failure paths
--   return one identical message, on purpose, so this cannot be distinguished
--   from "no such date on file" either). Calling it for a caller who cannot
--   see the date would abort this file before it ever reached the row-count
--   SELECT that was supposed to prove the negative -- and, worse, it would
--   abort the file EVERY time the security gate is doing its job correctly,
--   which is backwards: a correct implementation must leave this suite green.
--
--   Catching the raise needs `exception when`, which the runner bans file-wide
--   (see this file's own lack of one, and 07_write_path_defences.sql /
--   14_tag_visibility.sql for the identical reasoning about denials that
--   raise rather than filter). 14_tag_visibility.sql states the resulting rule
--   plainly: "only the succeeding direction is safe to attempt live inside
--   this harness" for anything that denies by raising.
--
-- So assertion 3 below asserts by ROW COUNT in the sense the runner actually
-- supports for a raising denial -- a `count(*) into v_x from pg_proc ...`
-- query, the same technique 13_occasion_materialization.sql's assertions 3-4
-- use for get_or_create_occasion's own raising guards -- rather than by
-- catching. Three checks, not one, because a bare source-text match risks
-- being vacuous the way 13's header warns about (a deleted companion check
-- there "could never have been anything but zero" for a reason unrelated to
-- the guard under test):
--
--   (a) a LIVE, non-raising call to can_view_field() itself, with the
--       fixture's real stored privacy_settings, proves THIS pairing
--       genuinely evaluates to false -- not merely that some guard exists in
--       source that might reference an unrelated pairing;
--   (b) a LIVE check that the private celebrant's profile_info row for this
--       kind actually EXISTS, proving the function would reach the
--       `not can_view_field(...)` half of its OR rather than the
--       `v_row is null` half -- so the row the inventory match counts is a
--       row that "would exist if the gate were missing" (per the task's
--       falsifiability standard) precisely because nothing else about this
--       fixture blocks it: the date is on file, the shape constraints on
--       occasions admit an ordinary celebrant row, and get_or_create_
--       celebrated_occasion runs SECURITY DEFINER so table RLS is not what
--       would have to stop it;
--   (c) the pg_get_functiondef() match itself, anchored line-by-line so a
--       commented-out guard cannot satisfy it (same `(?n)^\s*` technique
--       13_occasion_materialization.sql's post-review fix uses, with the same
--       KNOWN RESIDUE: a `/* ... */` block comment around the guard still
--       begins with whitespace and would still match). This is the one that
--       also proves can_view_field's arguments are NOT inverted -- the
--       pattern requires the literal call
--       `can_view_field(p_celebrant_id, v_caller, v_row.privacy_settings)`,
--       owner first, viewer second, exactly the order the interfaces block
--       specifies.
--
-- What this combination does NOT catch, stated plainly: a regression inside
-- can_view_field()'s OWN logic that (a) does not exercise, because (a) only
-- covers the empty-visibleToGroupTypes shape this fixture uses -- a
-- restrictToGroup regression, for instance, is 04_privacy_overrides.sql's
-- job, not this file's. And a functionally-equivalent but differently-worded
-- rewrite of the same guard would fail (c) even though nothing is actually
-- wrong -- the same accepted false-positive cost 14_tag_visibility.sql's
-- header names for its own exact-text policy match.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; function CALLS and
-- their result assertions run as `authenticated`, so `role` is toggled back
-- to the captured `current_user` around fixture mutations and catalog reads,
-- and finally before the token insert.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role      text;
  v_checks         int := 0;
  v_celeb          text := 'user_celebmat_celeb';
  v_giver          text := 'user_celebmat_giver';
  v_private        text := 'user_celebmat_private';
  v_group          uuid;
  v_id1            uuid;
  v_id2            uuid;
  v_count          int;
  v_can            boolean;
  v_priv_settings  jsonb;
  v_priv_rows      int;
  v_guard_defs     int;
  v_row_celebrant  text;
  v_row_created_by text;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values (v_celeb,   'celebmatceleb',   'Celebmat Celebrant'),
           (v_giver,   'celebmatgiver',   'Celebmat Giver'),
           (v_private, 'celebmatprivate', 'Celebmat Private');

  insert into groups (name, type, invite_code, created_by)
    values ('Celebmat Family', 'family', 'CELEBM01', v_celeb)
    returning id into v_group;

  -- add_group_creator_as_owner() already made v_celeb an 'owner'. v_giver
  -- joins so can_view_field(v_celeb, v_giver, ...) has a shared "family"
  -- group to find. v_private shares nothing with anyone -- irrelevant to
  -- assertion 3 anyway, since an empty visibleToGroupTypes array denies
  -- regardless of shared groups (can_view_field's own short-circuit).
  insert into group_members (group_id, user_id, role)
    values (v_group, v_giver, 'member')
    on conflict do nothing;

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values
      (v_celeb, 'dates', 'birthday', '1990-07-04',
       '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'),
      (v_private, 'dates', 'birthday', '1990-11-11',
       '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  -- Still the connecting (RLS-bypassing) role: capture v_private's REAL
  -- stored privacy_settings, and confirm the row genuinely exists, before
  -- anything below could be filtered by can_view_field's own reach into
  -- profile_info's SELECT policy. These feed checks (a) and (b) above.
  select pi.privacy_settings into v_priv_settings
    from profile_info pi
   where pi.user_id = v_private and pi.category = 'dates' and pi.field_name = 'birthday';

  select count(*) into v_priv_rows
    from profile_info
   where user_id = v_private and category = 'dates' and field_name = 'birthday';

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  ---------------------------------------------------------------------------
  -- Assertion 1: a caller who CAN see the celebrant's birthday materializes
  -- exactly one row.
  ---------------------------------------------------------------------------
  select public.get_or_create_celebrated_occasion(v_celeb, 'birthday') into v_id1;

  select count(*) into v_count from public.occasions where id = v_id1;
  if v_count <> 1 then
    raise exception
      'RLS FAIL: get_or_create_celebrated_occasion returned id % which resolves to % row(s) in occasions, expected exactly 1',
      v_id1, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: calling it again, for the same celebrant and kind, returns
  -- the SAME uuid and leaves exactly one row -- the idempotency
  -- occasions_celebrant_identity provides, same as get_or_create_occasion's
  -- own assertion 2 in 13_occasion_materialization.sql.
  ---------------------------------------------------------------------------
  select public.get_or_create_celebrated_occasion(v_celeb, 'birthday') into v_id2;

  if v_id2 is distinct from v_id1 then
    raise exception
      'RLS FAIL: second call to get_or_create_celebrated_occasion returned % instead of the first call''s %, expected idempotency',
      v_id2, v_id1;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from public.occasions
    where celebrant_id = v_celeb and kind = 'birthday';

  if v_count <> 1 then
    raise exception
      'RLS FAIL: two calls to get_or_create_celebrated_occasion left % birthday row(s) for %, expected exactly 1',
      v_count, v_celeb;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: a caller who CANNOT see the date creates no row. See the
  -- file header for why this is three live/inventory checks rather than one
  -- live attempt-and-count -- the call itself is not safe to make here.
  ---------------------------------------------------------------------------

  -- (a) The fixture's actual, stored privacy_settings genuinely deny v_giver.
  -- v_giver is now the pinned caller (request.jwt.claims set above), which is
  -- what can_view_field()'s self-pin requires of a non-service caller.
  select public.can_view_field(v_private, v_giver, v_priv_settings) into v_can;

  if v_can is distinct from false then
    raise exception
      'HARNESS FAIL: can_view_field(%, %, ...) returned % for the empty-visibleToGroupTypes fixture, expected false -- assertion 3 would be checking a guard that never had anything to deny',
      v_private, v_giver, v_can;
  end if;
  v_checks := v_checks + 1;

  -- (b) The private celebrant's date really is on file -- so the row the
  -- inventory check below counts is one that would exist if the guard were
  -- missing, not one already ruled out by "nothing to materialize".
  if v_priv_rows <> 1 then
    raise exception
      'HARNESS FAIL: fixture user % has % birthday row(s) in profile_info, expected exactly 1 -- assertion 3 would be exercising the "no such date on file" branch instead of the "cannot see it" branch',
      v_private, v_priv_rows;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connecting role for the catalog read, as 13_occasion_
  -- materialization.sql and 14_tag_visibility.sql do before their own
  -- pg_get_functiondef()/pg_policies checks.
  perform set_config('role', v_orig_role, true);

  -- (c) The guard is present, uncommented, wired to can_view_field() in the
  -- correct (owner, viewer, settings) argument order, and its errcode is
  -- tied to this specific raise. Anchored per line so a commented-out guard
  -- line cannot satisfy it (see file header for the accepted block-comment
  -- residue this does not close).
  select count(*) into v_guard_defs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'get_or_create_celebrated_occasion'
     and pg_get_functiondef(p.oid) ~ '(?n)^\s*if v_row is null$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*or not public\.can_view_field\(p_celebrant_id, v_caller, v_row\.privacy_settings\)$'
     and pg_get_functiondef(p.oid) ~ 'no visible % for that person''[^;]*22023';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: get_or_create_celebrated_occasion no longer contains its can_view_field guard, uncommented, in (owner, viewer, settings) order, with its errcode intact (matched % definition(s), expected 1) -- a caller who cannot see the date would fall through to the insert instead of raising',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  ---------------------------------------------------------------------------
  -- Assertion 4: celebrant_id and created_by, checked EXPLICITLY and
  -- separately. This is the shape that distinguishes this function from
  -- get_or_create_occasion(), which always sets both to the caller -- a
  -- swapped implementation (celebrant_id := v_caller, created_by :=
  -- p_celebrant_id) would fail BOTH of these on its own, but only because
  -- both are checked; checking just one (or just "the row exists") would
  -- let a swap through.
  ---------------------------------------------------------------------------
  select celebrant_id, created_by into v_row_celebrant, v_row_created_by
    from public.occasions where id = v_id1;

  if v_row_celebrant is distinct from v_celeb then
    raise exception
      'RLS FAIL: materialized row has celebrant_id=%, expected the celebrant % (not the caller %)',
      v_row_celebrant, v_celeb, v_giver;
  end if;
  v_checks := v_checks + 1;

  if v_row_created_by is distinct from v_giver then
    raise exception
      'RLS FAIL: materialized row has created_by=%, expected the calling giver % (not the celebrant %)',
      v_row_created_by, v_giver, v_celeb;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 8 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 8', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_15_celebrated_materialization');
end $$;

select token as result from _harness_result;
