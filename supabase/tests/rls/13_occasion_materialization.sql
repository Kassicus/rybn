-- get_or_create_occasion() must materialize exactly one occasion row per
-- caller per kind per year, do so idempotently under repeat calls, and never
-- create a row for a request it should refuse.
--
-- Two of its four behaviours (this file's assertions 3 and 4) are RAISES, not
-- graceful returns: p_kind => 'group_date' raises unconditionally, and a
-- caller with no matching profile_info row raises rather than returning NULL
-- -- confirmed directly against this project:
--
--   select public.get_or_create_occasion('group_date');
--   ERROR:  22023: group dates are created explicitly, not materialized
--
--   select public.get_or_create_occasion('birthday');  -- caller with nothing on file
--   ERROR:  22023: no birthday on file for this account
--
-- This harness cannot spell "this call must raise" directly. A raised
-- exception aborts the whole batch this file runs in -- confirmed directly
-- against this project too: a bare `select 1/0` mid-batch discards every
-- statement after it, including a subsequent `rollback to savepoint`, so
-- there is no way to recover from an uncaught raise inside one
-- `supabase db query` call. Catching it with a plpgsql exception handler is
-- exactly what the runner rejects outright (see 07_write_path_defences.sql's
-- header for the identical limitation on write denials: "there is no way to
-- spell 'this INSERT must raise' here"). What IS assertable without
-- exception handling is the INVENTORY: each guard is a specific piece of
-- function source, and a specific absence of a row is a plain SELECT. This
-- does not re-prove the guards fire -- that was executed directly against
-- the live database above -- it proves they have not been silently REMOVED,
-- which is the regression a future migration would actually cause.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; only the function CALLS
-- and their result assertions run as `authenticated`, so `role` is toggled
-- back to the captured `current_user` around each fixture mutation and,
-- finally, before the token insert.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role   text;
  v_checks      int := 0;
  v_celeb       text := 'user_occmat_celeb';
  v_nodate      text := 'user_occmat_nodate';
  v_bday_value  text;
  v_id1         uuid;
  v_id2         uuid;
  v_count       int;
  v_guard_defs  int;
  v_celebrant   text;
  v_group_id    uuid;
  v_kind        public.occasion_kind;
  v_occ_year    int;
  v_occ_date    date;
begin
  select current_user into v_orig_role;

  -- Month-day 10 days in the past, so THIS year's occurrence has already
  -- gone by and get_or_create_occasion() must roll it to NEXT year -- through
  -- the same celebration_date_in_year() helper the read path uses, so a tag
  -- and its display cannot disagree about which year the occasion falls in.
  v_bday_value := '1990-' || to_char(current_date - 10, 'MM-DD');

  insert into user_profiles (id, username, display_name)
    values (v_celeb,  'occmatcelebrant', 'Occmat Celebrant'),
           (v_nodate, 'occmatnodate',    'Occmat No Date');

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_celeb, 'dates', 'birthday', v_bday_value,
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_celeb || '","role":"authenticated"}', true);

  ---------------------------------------------------------------------------
  -- Assertion 1 (three checks): a birthday on file materializes exactly one
  -- row, celebrant_id = caller, group_id NULL -- and the date is rolled to
  -- NEXT year, since this year's month-day already passed, proving the same
  -- rollover the read path relies on actually ran.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  select public.get_or_create_occasion('birthday') into v_id1;

  select count(*) into v_count from public.occasions where id = v_id1;
  if v_count <> 1 then
    raise exception
      'RLS FAIL: get_or_create_occasion returned id % which resolves to % row(s) in occasions, expected exactly 1',
      v_id1, v_count;
  end if;
  v_checks := v_checks + 1;

  select celebrant_id, group_id, kind
    into v_celebrant, v_group_id, v_kind
    from public.occasions where id = v_id1;

  if v_celebrant is distinct from v_celeb or v_group_id is not null or v_kind <> 'birthday' then
    raise exception
      'RLS FAIL: materialized row has celebrant_id=%, group_id=%, kind=% -- expected celebrant_id=%, group_id=NULL, kind=birthday',
      v_celebrant, v_group_id, v_kind, v_celeb;
  end if;
  v_checks := v_checks + 1;

  select occasion_year, occasion_date into v_occ_year, v_occ_date
    from public.occasions where id = v_id1;

  if v_occ_year <> extract(year from current_date)::integer + 1 or v_occ_date <= current_date then
    raise exception
      'RLS FAIL: rollover birthday materialized into year % dated % -- expected year % and a future date, since this year''s month-day already passed',
      v_occ_year, v_occ_date, extract(year from current_date)::integer + 1;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2 (two checks): calling it again returns the SAME uuid and
  -- leaves exactly one row -- the idempotency occasions_celebrant_identity
  -- provides.
  ---------------------------------------------------------------------------
  select public.get_or_create_occasion('birthday') into v_id2;

  if v_id2 is distinct from v_id1 then
    raise exception
      'RLS FAIL: second call to get_or_create_occasion returned % instead of the first call''s %, expected idempotency',
      v_id2, v_id1;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_count
    from public.occasions
    where celebrant_id = v_celeb and kind = 'birthday';

  if v_count <> 1 then
    raise exception
      'RLS FAIL: two calls to get_or_create_occasion left % birthday row(s) for %, expected exactly 1 (the idempotency occasions_celebrant_identity is supposed to provide)',
      v_count, v_celeb;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 3 (one check): p_kind => 'group_date' must raise, never
  -- materialize a row. Per the header, this harness cannot invoke a call
  -- that raises and survive to emit its token, so this is an inventory
  -- check -- the guard's presence in the live function.
  --
  -- CORRECTION (post-review): the first cut of this check matched the `if`
  -- line and its message with `pg_get_functiondef(...) like '%...text...%'`,
  -- plus an independent `like '%22023%'`. pg_get_functiondef() returns the
  -- body INCLUDING comments, so commenting out just the guard's
  -- `if p_kind = 'group_date' then` line -- the likeliest shape of an
  -- accidental removal -- left every one of those conjuncts satisfied while
  -- the guard no longer executes; and `22023` is the errcode on three
  -- separate raises in this function (20260911000000:44,56,66), so checking
  -- for it independently of which message precedes it proved nothing about
  -- THIS guard specifically. Fixed two ways: the `if` line is now matched
  -- with `(?n)` (newline-sensitive mode) plus a `^\s*` anchor, so a line
  -- beginning with `--` cannot match; and the errcode is required
  -- immediately after this guard's OWN message, before any `;`, rather than
  -- anywhere in the function. The row-count companion check this used to
  -- pair with was deleted -- `group_date_shape`
  -- (20260910100000_occasions_schema.sql:44-46) makes a group_date row with
  -- a non-null celebrant_id unstorable regardless of whether this guard
  -- exists, so that count could never have been anything but zero and
  -- proved nothing about the guard under test.
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_or_create_occasion'
      and pg_get_functiondef(p.oid) ~ '(?n)^\s*if p_kind = ''group_date'' then'
      and pg_get_functiondef(p.oid) ~ 'group dates are created explicitly, not materialized''[^;]*22023';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: get_or_create_occasion no longer contains its group_date guard, uncommented, with its errcode intact (matched % definition(s), expected 1) -- kind => group_date would fall through to the insert instead of raising',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4 (two checks): a caller with no date of that kind on file
  -- creates no row -- also a raising path (v_value is null -> raise), so
  -- also an inventory check, same reasoning and same post-review fix as
  -- assertion 3 above.
  --
  -- The first check below guards the FIXTURE, not the function under test:
  -- it proves v_nodate genuinely has nothing for the SELECT to find, so the
  -- guard check that follows is not vacuous. (A third check used to sit
  -- here, counting occasions rows for v_nodate; it was deleted post-review
  -- because it could never fail -- v_nodate is created fresh in this
  -- transaction and the function is never called as them anywhere in this
  -- file, so that count could never have been anything but zero.)
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from profile_info
    where user_id = v_nodate and category = 'dates' and field_name = 'birthday';

  if v_count <> 0 then
    raise exception
      'HARNESS FAIL: fixture user % unexpectedly has a birthday on file (% row(s)) -- this assertion would be vacuous',
      v_nodate, v_count;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_guard_defs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'get_or_create_occasion'
      and pg_get_functiondef(p.oid) ~ '(?n)^\s*if v_value is null then'
      and pg_get_functiondef(p.oid) ~ 'no % on file for this account''[^;]*22023';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: get_or_create_occasion no longer contains its missing-date guard, uncommented, with its errcode intact (matched % definition(s), expected 1) -- a caller with nothing on file would silently succeed instead of raising',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connect role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  if v_checks < 8 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 8', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_13_occasion_materialization');
end $$;

select token as result from _harness_result;
