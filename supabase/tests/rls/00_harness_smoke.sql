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
--   3. End the file with a success token -- `select 'OK_<filename>' as result;`
--      The runner REQUIRES that token, so a file that silently did nothing
--      fails instead of passing.
--
-- The `true` third argument to set_config makes the setting local to the
-- transaction, which the runner always rolls back.
do $$
declare
  v_sub         text;
  v_role        text;
  v_who         text;
  v_orig_role   text;
  v_as_owner    bigint;
  v_as_authed   bigint;
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

  select auth.jwt()->>'role' into v_role;
  if v_role is distinct from 'authenticated' then
    raise exception 'HARNESS FAIL: expected role=authenticated, got %', v_role;
  end if;

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

  -- The switch that makes RLS apply.
  perform set_config('role', 'authenticated', true);

  select current_user into v_who;
  if v_who is distinct from 'authenticated' then
    raise exception
      'HARNESS FAIL: role switch did not take effect, current_user is %. RLS would be bypassed and every policy test would be vacuous.',
      v_who;
  end if;

  select count(*) into v_as_authed from harness_rls_probe;
  if v_as_authed <> 0 then
    raise exception
      'HARNESS FAIL: RLS is NOT enforced -- a deny-all table returned % row(s) as %. Every RLS test in this directory would be meaningless.',
      v_as_authed, v_who;
  end if;

  ---------------------------------------------------------------------------
  -- Part 3: the claims must survive the role switch, because that is the
  -- state Task 3's policies are evaluated in.
  ---------------------------------------------------------------------------
  select auth.jwt()->>'sub' into v_sub;
  if v_sub is distinct from 'user_harness_smoke' then
    raise exception
      'HARNESS FAIL: claims lost after the role switch, sub is %', v_sub;
  end if;

  perform set_config('role', v_orig_role, true);
end $$;

select 'OK_00_harness_smoke' as result;
