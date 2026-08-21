-- The anonymous role must have no reach into this schema, and every table must
-- have RLS switched on.
--
-- This is a schema INVARIANT check rather than a row-visibility test, and it
-- exists because the corresponding default cannot be fixed. Supabase's default
-- privileges hand every future object in `public` to anon, and PostgreSQL adds
-- its own EXECUTE-to-PUBLIC on top of that. The baseline revokes both, but a
-- revoke is one-shot: it fixes the objects that exist when it runs.
--
-- `alter default privileges ... revoke execute on functions from public` does
-- NOT close the gap. Measured on this database, a freshly created function
-- still arrives with a leading `=X/postgres` even though pg_default_acl holds
-- no PUBLIC entry -- the stored default is merged with the hardwired one
-- rather than replacing it, and "PUBLIC gets nothing" cannot be spelled as an
-- absent entry. anon is a member of PUBLIC, so the next migration's function
-- would be anon-executable by default.
--
-- Enforcing the invariant here is strictly stronger than a default privilege:
-- it holds no matter which role created the object, including objects created
-- through supabase_admin's default ACLs, which the migration role cannot
-- alter. If this file fails, the fix is an explicit
--     revoke execute on function public.<new_fn>(...) from public, anon;
-- or an `alter table ... enable row level security` in the migration that
-- added the object.
--
-- The last two assertions are controls. Four "count is zero" checks would all
-- pass just as happily against a catalog query that had stopped matching
-- anything, so the file also asserts the schema it is inspecting is really
-- there.

create temp table _harness_result (token text);

do $$
declare
  v_anon_fns     int;
  v_anon_tables  int;
  v_rls_off      int;
  v_public_pols  int;
  v_fn_total     int;
  v_table_total  int;
  v_checks       int := 0;
begin
  ---------------------------------------------------------------------------
  -- Nothing in public may be executable by anon. has_function_privilege picks
  -- up the grant whether it was made to anon directly or to PUBLIC.
  ---------------------------------------------------------------------------
  select count(*) into v_anon_fns
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and has_function_privilege('anon', p.oid, 'execute');

  if v_anon_fns <> 0 then
    raise exception
      'ANON REACH: % function(s) in schema public are executable by anon. A SECURITY DEFINER function reachable by anon is an unauthenticated read of whatever it touches; revoke execute from public, anon.',
      v_anon_fns;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Nor may anon hold any privilege on any relation.
  ---------------------------------------------------------------------------
  select count(*) into v_anon_tables
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind in ('r', 'p', 'v', 'm', 'f')
     and (has_table_privilege('anon', c.oid, 'select')
       or has_table_privilege('anon', c.oid, 'insert')
       or has_table_privilege('anon', c.oid, 'update')
       or has_table_privilege('anon', c.oid, 'delete')
       or has_table_privilege('anon', c.oid, 'truncate'));

  if v_anon_tables <> 0 then
    raise exception
      'ANON REACH: anon holds privileges on % relation(s) in schema public',
      v_anon_tables;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- A new table arrives with RLS DISABLED and grants cannot express otherwise,
  -- so the invariant is checked instead.
  ---------------------------------------------------------------------------
  select count(*) into v_rls_off
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
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
  -- door even when the grants are correct.
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
  -- Controls: the four checks above are only meaningful if there is in fact a
  -- schema here to inspect.
  ---------------------------------------------------------------------------
  select count(*) into v_fn_total
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public';

  if v_fn_total < 15 then
    raise exception
      'CONTROL FAIL: only % function(s) found in schema public, expected at least 15. The catalog query is not matching the baseline, so the zero counts above prove nothing.',
      v_fn_total;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_table_total
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r';

  if v_table_total < 14 then
    raise exception
      'CONTROL FAIL: only % table(s) found in schema public, expected at least 14. The catalog query is not matching the baseline, so the zero counts above prove nothing.',
      v_table_total;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 6 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 6. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_06_anon_has_no_reach');
end $$;

select token as result from _harness_result;
