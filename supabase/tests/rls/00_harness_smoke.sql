-- Proves the RLS harness can impersonate a Clerk user AND that row-level
-- security is actually enforced under that impersonation.
--
-- Depends on no application table, so it is valid before and after the schema
-- baseline.
--
-- CONVENTION for every file in this directory. Task 3's tests follow it:
--
--   1. perform set_config('request.jwt.claims',
--        '{"sub":"user_...","role":"authenticated"}', true);
--      makes auth.jwt() return the Clerk claims that policies read.
--
--   2. perform set_config('role', 'authenticated', true);
--      (equivalently: set local role authenticated)
--      is what actually causes policies to be EVALUATED. Step 1 alone is not
--      enough. The Supabase CLI connects as a superuser-ish login role with
--      rolbypassrls = true, so without this switch every policy is skipped and
--      a test passes no matter what the policy says.
--
--   3. COUNT the assertions, and emit the success token only from inside the
--      block, only after the count clears its floor:
--
--        create temp table _harness_result (token text);
--        do $$ declare v_checks int := 0; begin
--          ... assertion ...   v_checks := v_checks + 1;
--          if v_checks < <N> then raise exception 'HARNESS FAIL: ...'; end if;
--          insert into _harness_result values ('OK_<filename>');
--        end $$;
--        select token as result from _harness_result;
--
--      The runner REQUIRES the token `OK_<filename-without-.sql>`. Deriving it
--      from the assertion count is what makes the token mean something. A plain
--      trailing `select 'OK_...'` proves only that the file reached its last
--      line without raising: a file whose assertions were all commented out
--      would still emit it and still report PASS. With the counter, all three
--      neutering paths fail loudly:
--        - comment out one assertion   -> count drops below the floor, raises
--        - comment out the whole block -> temp table empty, no token emitted
--        - a bare trailing select      -> cannot reach the token at all
--
--      !! When you ADD an assertion to a file, raise its floor to match. !!
--      A floor left behind is a floor that has stopped catching anything.
--
-- The `true` third argument to set_config makes the setting local to the
-- transaction, which the runner always rolls back.

create temp table _harness_result (token text);

do $$
declare
  v_sub         text;
  v_role        text;
  v_who         text;
  v_orig_role   text;
  v_as_owner    bigint;
  v_as_authed   bigint;
  v_checks      int := 0;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Part 1: claims impersonation. auth.jwt() must echo the Clerk claims.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_harness_smoke","role":"authenticated"}', true);

  select auth.jwt()->>'sub' into v_sub;
  if v_sub is distinct from 'user_harness_smoke' then
    raise exception 'HARNESS FAIL: expected sub=user_harness_smoke, got %', v_sub;
  end if;
  v_checks := v_checks + 1;

  select auth.jwt()->>'role' into v_role;
  if v_role is distinct from 'authenticated' then
    raise exception 'HARNESS FAIL: expected role=authenticated, got %', v_role;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Part 2: RLS enforcement. A deny-all table must actually deny.
  --
  -- Part 1 proves only that a GUC round-trips. It would pass identically on a
  -- connection where RLS is bypassed entirely. This probe closes that gap. It
  -- is self-contained (a temp table, no application schema) and two-sided:
  --   positive control -- the row IS visible to the bypassing connect role,
  --   negative control -- the row is NOT visible to `authenticated`.
  -- The negative check alone would also pass if the INSERT had silently
  -- failed, which is exactly the kind of vacuous green this harness exists to
  -- prevent.
  ---------------------------------------------------------------------------
  create temp table harness_rls_probe (id int) on commit drop;
  insert into harness_rls_probe values (1);

  -- RLS enabled with zero policies == deny all.
  alter table harness_rls_probe enable row level security;
  grant select on harness_rls_probe to authenticated;

  select count(*) into v_as_owner from harness_rls_probe;
  if v_as_owner <> 1 then
    raise exception
      'HARNESS FAIL: probe row missing before the role switch (saw %, expected 1). The probe itself is broken, so its RLS result would mean nothing.',
      v_as_owner;
  end if;
  v_checks := v_checks + 1;

  -- The switch that makes RLS apply.
  perform set_config('role', 'authenticated', true);

  select current_user into v_who;
  if v_who is distinct from 'authenticated' then
    raise exception
      'HARNESS FAIL: role switch did not take effect, current_user is %. RLS would be bypassed and every policy test would be vacuous.',
      v_who;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_as_authed from harness_rls_probe;
  if v_as_authed <> 0 then
    raise exception
      'HARNESS FAIL: RLS is NOT enforced -- a deny-all table returned % row(s) as %. Every RLS test in this directory would be meaningless.',
      v_as_authed, v_who;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Part 3: the claims must survive the role switch, because that is the
  -- state Task 3's policies are evaluated in.
  ---------------------------------------------------------------------------
  select auth.jwt()->>'sub' into v_sub;
  if v_sub is distinct from 'user_harness_smoke' then
    raise exception
      'HARNESS FAIL: claims lost after the role switch, sub is %', v_sub;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- The token is earned, not printed. This file runs 6 assertions; if fewer
  -- ran, some were skipped or commented out and the file proves nothing.
  -- Raise this floor when you add an assertion above.
  ---------------------------------------------------------------------------
  if v_checks < 6 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 6. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_00_harness_smoke');
end $$;

select token as result from _harness_result;
