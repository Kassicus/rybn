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
--       LINE-commented guard cannot satisfy it (same `(?n)^\s*` technique
--       13_occasion_materialization.sql's post-review fix uses). Anchoring
--       alone does NOT stop a `/* ... */` block comment, which leaves every
--       line byte-identical -- that hole is closed separately, by the
--       no-block-comment floor asserted just before this match. This is the one that
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
--       CORRECTION (post-review, round 2): confirmed under adversarial
--       testing, and the join mechanism restated precisely rather than left
--       implicit. `standard_conforming_strings = on` (this project's
--       default) means the plain literal `\n` inside the pattern string is
--       the two ORDINARY characters backslash and `n`, nothing more --
--       confirmed directly: `length('a\nb') = 4`, and `'a\nb'` is distinct
--       from `E'a\nb'` (the E-string, with one actual embedded newline, has
--       length 3). The join across the two lines works because the ARE
--       (Advanced Regular Expression) COMPILER, not the SQL string-literal
--       parser, is what interprets that two-character `\n` as a newline
--       escape once the pattern reaches the regex engine -- two separate
--       layers, worth naming explicitly: reaching for an E-string here to
--       "clarify" this line would silently change what gets matched, not
--       merely how it is spelled.
--
--       Retested adversarially and all three of the following are correctly
--       REJECTED (v_guard_defs = 0): the errcode changed on an otherwise-
--       intact raise; the two lines physically reordered (`using errcode`
--       first, `raise exception` second); and a `--` comment line inserted
--       between them. One tolerance found and deliberately accepted, not
--       chased further: an intervening BLANK line between the two still
--       matches (confirmed directly). Cause: `\s`, unlike `.` and a
--       negated bracket expression, still matches a literal newline even
--       under `(?n)` newline-sensitive mode, so the `\s*` right after the
--       joining `\n` also swallows one further blank line. A blank line
--       changes nothing about what actually executes, so this costs
--       nothing.
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
  v_celeb_dec31    text := 'user_celebmat_dec31';
  v_giver          text := 'user_celebmat_giver';
  v_private        text := 'user_celebmat_private';
  v_group          uuid;
  v_id1            uuid;
  v_id2            uuid;
  v_id_dec31       uuid;
  v_count          int;
  v_can            boolean;
  v_priv_settings  jsonb;
  v_priv_rows      int;
  v_guard_defs     int;
  v_block_comment_pos int;
  v_row_celebrant  text;
  v_row_created_by text;
  v_row_kind       public.occasion_kind;
  v_row_group      uuid;
  v_bday_celeb     text;
  v_bday_dec31     text;
  v_expected_year_celeb int;
  v_expected_year_dec31 int;
  v_occ_year       int;
  v_occ_date       date;
begin
  select current_user into v_orig_role;

  -- Two FIXED CALENDAR ANCHORS, not derived offsets, so the this-year-or-
  -- next-year rollover in get_or_create_celebrated_occasion is exercised in
  -- BOTH directions on every day of the year but one.
  --
  -- CORRECTION (post-review, round 2): the first cut derived both fixtures
  -- from current_date (-10 / +10 days). That has a structural blind spot,
  -- not an off-by-one: ANY fixture built by subtracting N days wraps into
  -- the PREVIOUS calendar year whenever today is within N days of Jan 1,
  -- landing on a December month-day, which is always still in the future --
  -- no rollover forced, on EITHER fixture, for up to 2*N days a year.
  -- Confirmed independently by the reviewer: on Jan 5, `current_date - 10`
  -- has month-day Dec 26 (future) and `current_date + 10` has month-day
  -- Jan 15 (also future) -- deleting the rollover branch entirely would
  -- have left this suite green that day. Widening the offset only moves the
  -- window; it does not close it.
  --
  -- Fixed anchors close it down to exactly one unavoidable day:
  --   Jan 1  -- celebration_date_in_year(Jan-1, thisYear) is in the PAST on
  --             every day except Jan 1 itself, so it MUST roll. Expected
  --             year is thisYear + 1.
  --   Dec 31 -- celebration_date_in_year(Dec-31, thisYear) is NEVER before
  --             today, on any day of the year, so it must NEVER roll.
  --             Expected year is thisYear -- a true constant, no `case`
  --             needed at all.
  --
  -- JAN 1 ITSELF IS A PROPERTY OF THE CODE, NOT A GAP IN THIS TEST. The
  -- rollover branch is `v_date < current_date`. On Jan 1, v_date is computed
  -- IN the current year, so it ranges over Jan 1..Dec 31 and can never be
  -- less than Jan 1 -- the branch is PROVABLY unreachable that day, for
  -- every possible birthday, not just this fixture's. No fixture, anchored
  -- or derived, can force it on Jan 1. So the Jan 1 anchor's expected year
  -- below carries exactly one `case` for that single day (thisYear, not
  -- thisYear + 1) -- stated here rather than silently computed, so a reader
  -- does not mistake it for a gap.
  --
  -- Both expectations are asserted as the NEAR-CONSTANTS above, stated
  -- directly -- NOT by re-deriving the general "if date_in_current_year <
  -- today then +1" rule through celebration_date_in_year() the way the
  -- first cut did. Doing that would reproduce the logic under test in the
  -- test itself and pass whatever the migration does, rollover branch
  -- included or not.
  --
  -- EXHAUSTIVE PROOF (read-only, full detail in the task report, not
  -- re-run here): for every day of a 365-day year (2023) and a 366-day leap
  -- year (2024, Feb 29 included), the intact function's actual
  -- occasion_year for BOTH anchors was compared against (a) the
  -- near-constant expectations below and (b) what a branch-deleted variant
  -- would produce. Zero expectation mismatches across both years (731
  -- days) -- these near-constants are correct on every day, not just
  -- today's. Exactly one day PER YEAR has both anchors land on the same
  -- year with or without the branch: Jan 1, matching the proof above --
  -- confirming this is the single, unavoidable, already-documented blind
  -- spot and not a wider one slipping back in. Feb 29, included in the
  -- 2024 run, produced no mismatch either.
  v_bday_celeb := '1990-01-01';
  v_expected_year_celeb := case
    when extract(month from current_date) = 1 and extract(day from current_date) = 1
    then extract(year from current_date)::integer
    else extract(year from current_date)::integer + 1
  end;

  v_bday_dec31 := '1990-12-31';
  v_expected_year_dec31 := extract(year from current_date)::integer;

  insert into user_profiles (id, username, display_name)
    values (v_celeb,       'celebmatceleb',   'Celebmat Celebrant'),
           (v_celeb_dec31, 'celebmatdec31',   'Celebmat Dec31 Celebrant'),
           (v_giver,       'celebmatgiver',   'Celebmat Giver'),
           (v_private,     'celebmatprivate', 'Celebmat Private');

  insert into groups (name, type, invite_code, created_by)
    values ('Celebmat Family', 'family', 'CELEBM01', v_celeb)
    returning id into v_group;

  -- add_group_creator_as_owner() already made v_celeb an 'owner'. v_giver and
  -- v_celeb_dec31 join so can_view_field(..., v_giver, ...) has a shared
  -- "family" group to find for both celebrants. v_private shares nothing
  -- with anyone -- irrelevant to assertion 3 anyway, since an empty
  -- visibleToGroupTypes array denies regardless of shared groups
  -- (can_view_field's own short-circuit).
  insert into group_members (group_id, user_id, role)
    values (v_group, v_giver, 'member'),
           (v_group, v_celeb_dec31, 'member')
    on conflict do nothing;

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values
      (v_celeb, 'dates', 'birthday', v_bday_celeb,
       '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'),
      (v_celeb_dec31, 'dates', 'birthday', v_bday_dec31,
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
  -- EXPECTED year for the Jan 1 anchor (see the declare block for why Jan 1,
  -- why the year is a near-constant rather than re-derived, and the one day
  -- it is provably unreachable). celebrant_id/created_by get their own
  -- explicit, separate assertion (4) below, per the task brief.
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

  -- occ_date < current_date (not <=) because on Jan 1 itself the Jan 1
  -- anchor's occasion_date IS current_date exactly -- see the declare
  -- block. That is correct behaviour, not staleness.
  if v_occ_year <> v_expected_year_celeb or v_occ_date < current_date then
    raise exception
      'RLS FAIL: celebrated occasion (Jan 1 anchor) materialized into year % dated % -- expected year % (near-constant, see declare block) and a date not in the past',
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
  ---------------------------------------------------------------------------
  -- THE FLOOR BENEATH THE ANCHORED MATCH BELOW.
  --
  -- Line-anchoring stops a `--` prefix, which moves where a line starts. It
  -- does nothing against a `/* ... */` block comment, which leaves every line
  -- byte-identical and merely brackets them -- and `\s` matches newline in a
  -- POSIX ARE even under `(?n)`, since `n` constrains only `.` and negated
  -- bracket expressions. So the whole guard could be commented out with `/*`
  -- and every pattern below would still match.
  --
  -- 17_claim_lifecycle.sql closed this for claim_wishlist_item after review;
  -- this file documented the same residue as KNOWN and left it open, while
  -- guarding get_or_create_celebrated_occasion -- the other SECURITY DEFINER
  -- function in this phase that takes a subject parameter. One assertion
  -- covers every anchored pattern here at once, and unlike a per-pattern
  -- negative lookahead it cannot be worked around.
  ---------------------------------------------------------------------------
  select position('/*' in pg_get_functiondef(p.oid)) into v_block_comment_pos
    from pg_proc p
   where p.oid = 'public.get_or_create_celebrated_occasion(text, public.occasion_kind)'::regprocedure;

  if v_block_comment_pos <> 0 then
    raise exception
      'GUARD FAIL: get_or_create_celebrated_occasion''s definition contains a /* block comment starting at character % -- every anchored check in this file is unsound while this is true (line-anchoring does not defend against a block comment)',
      v_block_comment_pos;
  end if;
  v_checks := v_checks + 1;

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
  -- Assertion 5 (two checks): the rollover helper's OTHER branch, on the
  -- Dec 31 anchor. Dec 31 of the current year is never before today, on any
  -- day of the year, so it must NEVER roll -- expected year is a true
  -- constant (see the declare block). Assertion 1's Jan 1 anchor exercises
  -- "must roll" (except the one provably-unreachable day, Jan 1 itself);
  -- this exercises "must not roll", unconditionally, every day. Together
  -- they are the concrete exploit this closes: deleting migration:67-69's
  -- `if v_date < current_date then ... end if;` rollover changes the Jan 1
  -- anchor's occasion_year on every day but one -- see the exhaustive proof
  -- in the declare block and the task report.
  ---------------------------------------------------------------------------
  select public.get_or_create_celebrated_occasion(v_celeb_dec31, 'birthday') into v_id_dec31;

  select count(*) into v_count from public.occasions where id = v_id_dec31;
  if v_count <> 1 then
    raise exception
      'RLS FAIL: get_or_create_celebrated_occasion returned id % which resolves to % row(s) in occasions, expected exactly 1',
      v_id_dec31, v_count;
  end if;
  v_checks := v_checks + 1;

  select occasion_year, occasion_date into v_occ_year, v_occ_date
    from public.occasions where id = v_id_dec31;

  -- occ_date < current_date (not <=) because on Dec 31 itself the Dec 31
  -- anchor's occasion_date IS current_date exactly -- same reasoning as
  -- assertion 1's comment above.
  if v_occ_year <> v_expected_year_dec31 or v_occ_date < current_date then
    raise exception
      'RLS FAIL: celebrated occasion (Dec 31 anchor) materialized into year % dated % -- expected year % (a true constant, see declare block) and a date not in the past',
      v_occ_year, v_occ_date, v_expected_year_dec31;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  if v_checks < 13 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 12', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_15_celebrated_materialization');
end $$;

select token as result from _harness_result;
