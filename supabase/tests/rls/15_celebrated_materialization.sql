-- get_or_create_celebrated_occasion() must materialize SOMEBODY ELSE's
-- occasion only when the caller can actually see that person's date, must do
-- so idempotently, must stamp celebrant_id/created_by the right way round,
-- must roll a passed date to the following year using the same helper the
-- read path uses (in both directions -- a date not yet passed must NOT
-- roll), and must never create a row for a caller the privacy model would
-- hide the date from.
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
--       CORRECTION (post-review, round 1): the first cut of (c) tied the
--       errcode to the raise with a THIRD pattern,
--       `'no visible % for that person''[^;]*22023'`, run in DEFAULT (non
--       `(?n)`) mode -- `(?n)` scopes to the single regex it appears in, not
--       to the whole query, and in default mode `[^;]` matches newlines and
--       nothing is line-anchored. Confirmed directly against this project: a
--       scratch copy with the guard's raise commented out --
--         null;  -- raise exception 'no visible % for that person' , p_kind
--                --   using errcode = '22023';
--       -- satisfied that pattern (old_pattern_matches_intact = true against
--       BOTH the intact function and the commented-out one), which would have
--       let a `raise` downgraded to `null` (or to `raise notice`, which still
--       accepts `using errcode`) pass every check in this file. Fixed by
--       replacing it with ONE `(?n)`-mode pattern spanning both lines,
--       joined by a literal `\n` rather than `[^;]*`, so `^`/`$` anchor each
--       half to its own line and an intervening `--` comment cannot bridge
--       them: `^\s*raise exception '...' , p_kind\n\s*using errcode =
--       '22023';$`. This still ties the errcode to THIS raise specifically
--       (not just to some `22023` elsewhere in the function -- there are
--       three others), while refusing anything that does not begin the line
--       with the literal `raise exception` text.
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
  v_celeb_soon     text := 'user_celebmat_soon';
  v_giver          text := 'user_celebmat_giver';
  v_private        text := 'user_celebmat_private';
  v_group          uuid;
  v_id1            uuid;
  v_id2            uuid;
  v_id_soon        uuid;
  v_count          int;
  v_can            boolean;
  v_priv_settings  jsonb;
  v_priv_rows      int;
  v_guard_defs     int;
  v_row_celebrant  text;
  v_row_created_by text;
  v_row_kind       public.occasion_kind;
  v_row_group      uuid;
  v_bday_celeb     text;
  v_bday_soon      text;
  v_expected_year_celeb int;
  v_expected_year_soon  int;
  v_occ_year       int;
  v_occ_date       date;
begin
  select current_user into v_orig_role;

  -- Two birthdays, not one, so the this-year-or-next-year rollover in
  -- get_or_create_celebrated_occasion is exercised in BOTH directions rather
  -- than assumed. v_bday_celeb mirrors 13_occasion_materialization.sql's own
  -- fixture (current_date - 10, "usually" already past this year, so the
  -- function must roll it to next year); v_bday_soon is its mirror image
  -- (current_date + 10, "usually" still upcoming this year, so it must NOT
  -- roll). Neither offset is trusted to land on a particular side of the
  -- rollover -- the EXPECTED year is computed through
  -- celebration_date_in_year(), the same helper get_or_create_celebrated_
  -- occasion itself calls, so the assertions below are correct on every
  -- calendar day, not just today's. Known residue, same as 13's: within
  -- roughly the first/last ten days of a calendar year a month-day wraps
  -- across the year boundary and can land on the OTHER branch than the
  -- offset's name suggests -- harmless, because the expectation is computed
  -- from the fixture, never hardcoded.
  v_bday_celeb := '1990-' || to_char(current_date - 10, 'MM-DD');
  v_expected_year_celeb := case
    when public.celebration_date_in_year(v_bday_celeb, extract(year from current_date)::integer) < current_date
    then extract(year from current_date)::integer + 1
    else extract(year from current_date)::integer
  end;

  v_bday_soon := '1990-' || to_char(current_date + 10, 'MM-DD');
  v_expected_year_soon := case
    when public.celebration_date_in_year(v_bday_soon, extract(year from current_date)::integer) < current_date
    then extract(year from current_date)::integer + 1
    else extract(year from current_date)::integer
  end;

  insert into user_profiles (id, username, display_name)
    values (v_celeb,      'celebmatceleb',   'Celebmat Celebrant'),
           (v_celeb_soon, 'celebmatsoon',    'Celebmat Soon Celebrant'),
           (v_giver,      'celebmatgiver',   'Celebmat Giver'),
           (v_private,    'celebmatprivate', 'Celebmat Private');

  insert into groups (name, type, invite_code, created_by)
    values ('Celebmat Family', 'family', 'CELEBM01', v_celeb)
    returning id into v_group;

  -- add_group_creator_as_owner() already made v_celeb an 'owner'. v_giver and
  -- v_celeb_soon join so can_view_field(..., v_giver, ...) has a shared
  -- "family" group to find for both celebrants. v_private shares nothing
  -- with anyone -- irrelevant to assertion 3 anyway, since an empty
  -- visibleToGroupTypes array denies regardless of shared groups
  -- (can_view_field's own short-circuit).
  insert into group_members (group_id, user_id, role)
    values (v_group, v_giver, 'member'),
           (v_group, v_celeb_soon, 'member')
    on conflict do nothing;

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values
      (v_celeb, 'dates', 'birthday', v_bday_celeb,
       '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'),
      (v_celeb_soon, 'dates', 'birthday', v_bday_soon,
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
  -- Assertion 1 (three checks): a caller who CAN see the celebrant's
  -- birthday materializes exactly one row, of the right shape --
  -- kind='birthday', group_id NULL, same as get_or_create_occasion's own
  -- assertion 1 in 13_occasion_materialization.sql -- landed in the
  -- EXPECTED year (computed above from v_bday_celeb via the same
  -- celebration_date_in_year() helper the function itself uses, not
  -- hardcoded), proving the rollover actually ran rather than being
  -- unasserted. celebrant_id/created_by get their own explicit, separate
  -- assertion (4) below, per the task brief.
  ---------------------------------------------------------------------------
  select public.get_or_create_celebrated_occasion(v_celeb, 'birthday') into v_id1;

  select count(*) into v_count from public.occasions where id = v_id1;
  if v_count <> 1 then
    raise exception
      'RLS FAIL: get_or_create_celebrated_occasion returned id % which resolves to % row(s) in occasions, expected exactly 1',
      v_id1, v_count;
  end if;
  v_checks := v_checks + 1;

  select kind, group_id into v_row_kind, v_row_group
    from public.occasions where id = v_id1;

  if v_row_kind <> 'birthday' or v_row_group is not null then
    raise exception
      'RLS FAIL: materialized row has kind=%, group_id=%, expected kind=birthday, group_id=NULL',
      v_row_kind, v_row_group;
  end if;
  v_checks := v_checks + 1;

  select occasion_year, occasion_date into v_occ_year, v_occ_date
    from public.occasions where id = v_id1;

  if v_occ_year <> v_expected_year_celeb or v_occ_date <= current_date then
    raise exception
      'RLS FAIL: celebrated occasion materialized into year % dated % -- expected year % (computed from v_bday_celeb via celebration_date_in_year(), not assumed) and a future date',
      v_occ_year, v_occ_date, v_expected_year_celeb;
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
  -- tied to this specific raise. Every pattern is anchored per line (see the
  -- post-review correction in the file header for why the third one has to
  -- span two anchored lines joined by a literal `\n`, rather than the
  -- unanchored `[^;]*` the first cut used). Scoped by exact regprocedure, not
  -- proname alone, so an ungated overload with an extra parameter cannot
  -- also satisfy this count.
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.get_or_create_celebrated_occasion(text, public.occasion_kind)'::regprocedure
     and pg_get_functiondef(p.oid) ~ '(?n)^\s*if v_row is null$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*or not public\.can_view_field\(p_celebrant_id, v_caller, v_row\.privacy_settings\)$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''no visible % for that person'' , p_kind\n\s*using errcode = ''22023'';$';

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

  ---------------------------------------------------------------------------
  -- Assertion 5 (two checks): the rollover helper's OTHER branch. v_celeb's
  -- fixture in assertion 1 exercises "this year's date has already passed,
  -- roll to next year"; v_celeb_soon is its mirror image, exercising "this
  -- year's date has not happened yet, stay in this year". Both compute their
  -- expected year through celebration_date_in_year() rather than a hardcoded
  -- literal (see the declare block), so this is correct on every calendar
  -- day the suite happens to run on, not just today's -- the concrete
  -- exploit this closes: deleting migration:67-69's
  -- `if v_date < current_date then ... end if;` rollover would leave this
  -- file green every day of the year, because nothing before this assertion
  -- checked occasion_date/occasion_year at all.
  ---------------------------------------------------------------------------
  select public.get_or_create_celebrated_occasion(v_celeb_soon, 'birthday') into v_id_soon;

  select count(*) into v_count from public.occasions where id = v_id_soon;
  if v_count <> 1 then
    raise exception
      'RLS FAIL: get_or_create_celebrated_occasion returned id % which resolves to % row(s) in occasions, expected exactly 1',
      v_id_soon, v_count;
  end if;
  v_checks := v_checks + 1;

  select occasion_year, occasion_date into v_occ_year, v_occ_date
    from public.occasions where id = v_id_soon;

  if v_occ_year <> v_expected_year_soon or v_occ_date <= current_date then
    raise exception
      'RLS FAIL: celebrated occasion (no-rollover fixture) materialized into year % dated % -- expected year % (computed from v_bday_soon via celebration_date_in_year(), not assumed) and a future date',
      v_occ_year, v_occ_date, v_expected_year_soon;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 12 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 12', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_15_celebrated_materialization');
end $$;

select token as result from _harness_result;
