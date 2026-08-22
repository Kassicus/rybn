-- The anonymous role must have no reach into this schema, every table must
-- have RLS switched on, and no policy may be left open to PUBLIC.
--
-- This is a schema INVARIANT check rather than a row-visibility test. Grants
-- and RLS are per-object, applied by whoever wrote the migration, so the only
-- durable way to state "and it must stay this way" is to assert it over the
-- catalog.
--
-- Default privileges now cover the future cases that can be covered: the
-- baseline revokes anon from future tables, sequences and functions, and the
-- DATABASE-WIDE `alter default privileges revoke execute on functions from
-- public` removes PostgreSQL's hardwired EXECUTE-to-PUBLIC (the `IN SCHEMA`
-- form cannot -- a per-schema entry only ever adds to the global slot). This
-- file is the belt to that pair of braces: defaults apply to objects created
-- by the migration role, and say nothing about objects created any other way,
-- including through supabase_admin's default ACLs, which the migration role
-- cannot alter.
--
-- If this file fails, the fix is in the migration that added the object:
--     revoke execute on function public.<new_fn>(...) from public, anon;
--     alter table public.<new_table> enable row level security;
--     create policy ... to authenticated ...   -- never a bare `create policy`
--
-- SCHEMA `storage` IS IN SCOPE TOO, for the one thing that can be stated
-- generally. The file used to scan only `public`, which made its name an
-- overstatement: `storage.objects` shipped with two `to public` SELECT policies
-- and this file said nothing about them, so "anon has no reach" was green while
-- anon could read every gift photo row in the project.
--
-- Only the POLICY check is extended, not the grant checks. Supabase issues anon
-- a plain SELECT grant on storage.objects in every project; that grant is not
-- ours to revoke and asserting it away would fail against a stock project while
-- proving nothing. It also does not matter, because with no policy admitting
-- anon the grant reaches zero rows -- which is precisely why the policy check
-- is the one that belongs here.
--
-- The deep storage assertions -- buckets private, the owner-scoped policies
-- correct, and anon actually reading zero object rows -- live in
-- 10_private_storage.sql. This file only holds the line that anon is never
-- named, in any schema it touches.
--
-- The last four assertions are population controls. Six "count is zero"
-- checks would all pass just as happily against catalog queries that had
-- stopped matching anything, so the file also asserts the schema it is
-- inspecting is really there.

create temp table _harness_result (token text);

do $$
declare
  v_anon_fns     int;
  v_anon_rels    int;
  v_anon_seqs    int;
  v_rls_off      int;
  v_public_pols  int;
  v_fn_total     int;
  v_table_total  int;
  v_policy_total int;
  v_stor_public  int;
  v_stor_total   int;
  v_checks       int := 0;
begin
  ---------------------------------------------------------------------------
  -- Nothing in public may be executable by anon. has_function_privilege picks
  -- the grant up whether it was made to anon directly or to PUBLIC, and
  -- prokind is not filtered, so procedures and aggregates count too.
  ---------------------------------------------------------------------------
  select count(*) into v_anon_fns
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute');

  if v_anon_fns <> 0 then
    raise exception
      'ANON REACH: % routine(s) in schema public are executable by anon. A SECURITY DEFINER routine reachable by anon is an unauthenticated read of whatever it touches; revoke execute from public, anon.',
      v_anon_fns;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Nor may anon hold any privilege on any relation. Partitioned tables ('p'),
  -- views ('v'), materialised views ('m') and foreign tables ('f') are all
  -- readable things and all included.
  ---------------------------------------------------------------------------
  select count(*) into v_anon_rels
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete')
       or has_table_privilege('anon', c.oid, 'truncate'));

  if v_anon_rels <> 0 then
    raise exception
      'ANON REACH: anon holds privileges on % relation(s) in schema public',
      v_anon_rels;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Sequences are a separate relkind with their own privilege verbs, and this
  -- file is called "anon has no reach". There are none today, which is exactly
  -- why the check belongs here now rather than after the first one appears.
  ---------------------------------------------------------------------------
  select count(*) into v_anon_seqs
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'S'
     and (has_sequence_privilege('anon', c.oid, 'usage')
       or has_sequence_privilege('anon', c.oid, 'select')
       or has_sequence_privilege('anon', c.oid, 'update'));

  if v_anon_seqs <> 0 then
    raise exception
      'ANON REACH: anon holds privileges on % sequence(s) in schema public',
      v_anon_seqs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- A new table arrives with RLS DISABLED and no grant can express otherwise,
  -- so the invariant is checked instead. Partitioned tables included: RLS is
  -- declared on the partitioned parent.
  ---------------------------------------------------------------------------
  select count(*) into v_rls_off
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p')
     and not c.relrowsecurity;

  if v_rls_off <> 0 then
    raise exception
      'RLS OFF: % table(s) in schema public have row level security disabled. A new table does not get it automatically; add `alter table ... enable row level security`.',
      v_rls_off;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- A policy written without an explicit TO clause applies to PUBLIC, which
  -- includes anon. That is how an anonymous read gets in through the front
  -- door even when every grant is correct.
  ---------------------------------------------------------------------------
  select count(*) into v_public_pols
    from pg_policies
   where schemaname = 'public'
     and 'public' = any(roles);

  if v_public_pols <> 0 then
    raise exception
      'OPEN POLICY: % policy/policies in schema public apply to PUBLIC rather than a named role. Add an explicit `to authenticated`.',
      v_public_pols;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The same rule, in schema `storage`. A `to public` policy there is how an
  -- unauthenticated caller reads the object rows behind every wishlist image
  -- and gift photo, and it is exactly the shape this project shipped with.
  ---------------------------------------------------------------------------
  select count(*) into v_stor_public
    from pg_policies
   where schemaname = 'storage'
     and 'public' = any(roles);

  if v_stor_public <> 0 then
    raise exception
      'OPEN POLICY: % policy/policies in schema storage apply to PUBLIC rather than a named role. anon holds a SELECT grant on storage.objects, so such a policy is an unauthenticated read of every uploaded image.',
      v_stor_public;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- link_fetch_log is the rate-limit ledger behind the link-preview fetcher,
  -- and it is service-role only: RLS on, and deliberately not one policy. Both
  -- facts are asserted by name rather than left to the sweeps above, because
  -- the sweeps say "no table has RLS off" and "no policy is open to PUBLIC" --
  -- and a `to authenticated` policy added here would satisfy both while
  -- handing the user the ledger that counts them. The RLS check is written as
  -- `not exists` over pg_tables rather than as a rowsecurity comparison, so it
  -- also fails if the table has gone missing altogether, which no other check
  -- in this file would notice.
  --
  -- The ledger holds a user id and a timestamp. A user has nothing to read
  -- here and must not be able to trim their own row, which is the whole point
  -- of the rate limit.
  ---------------------------------------------------------------------------
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'link_fetch_log' and rowsecurity
  ) then
    raise exception 'link_fetch_log does not have RLS enabled';
  end if;
  v_checks := v_checks + 1;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'link_fetch_log'
  ) then
    raise exception 'link_fetch_log must have no policies -- it is service-role only';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Population controls: the six zero-count checks above are only meaningful
  -- if there is in fact a schema here to inspect.
  ---------------------------------------------------------------------------
  select count(*) into v_stor_total
    from pg_policies
   where schemaname = 'storage';

  if v_stor_total < 8 then
    raise exception
      'CONTROL FAIL: only % policy/policies found in schema storage, expected at least 8. The storage check above is inspecting nothing.',
      v_stor_total;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_fn_total
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  if v_fn_total < 15 then
    raise exception
      'CONTROL FAIL: only % routine(s) found in schema public, expected at least 15. The catalog query is not matching the baseline, so the zero counts above prove nothing.',
      v_fn_total;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_table_total
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p');

  if v_table_total < 14 then
    raise exception
      'CONTROL FAIL: only % table(s) found in schema public, expected at least 14. The catalog query is not matching the baseline, so the zero counts above prove nothing.',
      v_table_total;
  end if;
  v_checks := v_checks + 1;

  -- Without this, a schema that had lost every policy would sail through the
  -- open-policy check above.
  select count(*) into v_policy_total
    from pg_policies
   where schemaname = 'public';

  if v_policy_total < 59 then
    raise exception
      'CONTROL FAIL: only % policy/policies found in schema public, expected at least 59. Policies have gone missing, and the open-policy check above proves nothing.',
      v_policy_total;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 12 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 12. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_06_anon_has_no_reach');
end $$;

select token as result from _harness_result;
