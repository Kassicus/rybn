-- The write-path defences must still be in place.
--
-- HOW THIS FILE IS SHAPED, AND WHY IT IS NOT LIKE THE OTHERS.
--
-- Files 01-04 assert behaviour: they perform a read and check what came back.
-- The three escalations below are WRITE denials, and this harness cannot
-- assert a write is denied. A denied write raises, which aborts the do-block,
-- and catching it would need an exception handler -- which the runner rejects
-- outright, correctly, because a handler around an assertion turns a real
-- failure into a passing token. So there is no way to spell "this INSERT must
-- raise" here.
--
-- What is assertable without any exception handling is the INVENTORY: each of
-- these three defences is implemented by a specific database object, and an
-- object's existence is a plain SELECT against pg_catalog. That is what this
-- file checks. It does not re-prove that the defences work -- that was done by
-- executing each attack against the live database and watching it be refused,
-- recorded in the task report. It proves they have not been REMOVED, which is
-- the regression a future migration would actually cause.
--
-- The limitation is real and worth stating plainly: assertion 2 matches a
-- substring of a policy expression. A policy could keep the is_group_member
-- call and still be wrong. This is the difference between "a future migration
-- silently reopens a proven product-secret leak" and "the suite fails naming
-- the table" -- not between correct and incorrect.
--
-- A general "assert this statement raises" facility belongs in the harness,
-- not here, and is recorded as a follow-up.

create temp table _harness_result (token text);

do $$
declare
  v_missing       text;
  v_exchange_ins  int;
  v_update_open   int;
  v_update_total  int;
  v_checks        int := 0;
begin
  ---------------------------------------------------------------------------
  -- 1. The immutability triggers. RLS has no access to the OLD row, so "this
  --    column may not be reassigned" is inexpressible in a policy. Each of
  --    these three triggers closes a demonstrated escalation:
  --      group_gift_members         -> repointing group_gift_id granted SELECT
  --                                    on a stranger's gift chat
  --      gift_exchange_participants -> repointing exchange_id exposed another
  --                                    exchange's roster and its assignments
  --      date_notifications         -> repointing celebrant_id/group_id made
  --                                    get_dates_today_for_user() return an
  --                                    arbitrary user's name and a private
  --                                    group's name and type
  ---------------------------------------------------------------------------
  select string_agg(t.tbl, ', ' order by t.tbl) into v_missing
    from (values ('group_gift_members'),
                 ('gift_exchange_participants'),
                 ('date_notifications')) as t(tbl)
   where not exists (
     select 1
       from pg_trigger tg
       join pg_class c on c.oid = tg.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_proc p on p.oid = tg.tgfoid
      where n.nspname = 'public'
        and c.relname = t.tbl
        and not tg.tgisinternal
        and tg.tgenabled = 'O'
        and p.proname = 'reject_parent_reassignment');

  if v_missing is not null then
    raise exception
      'WRITE PATH: the reject_parent_reassignment trigger is missing or disabled on: %. Without it the parent FK on that table can be repointed by its owner, which is how a stranger reaches another group''s data.',
      v_missing;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 2. The exchange INSERT policy must still require group membership. Its
  --    absence is what let anyone holding an exchange UUID insert themselves
  --    as a participant and read the Secret Santa assignments.
  ---------------------------------------------------------------------------
  select count(*) into v_exchange_ins
    from pg_policies
   where schemaname = 'public'
     and tablename = 'gift_exchange_participants'
     and cmd = 'INSERT'
     and with_check like '%is_group_member%';

  if v_exchange_ins <> 1 then
    raise exception
      'WRITE PATH: the gift_exchange_participants INSERT policy no longer requires is_group_member (matched % policy/policies, expected 1). Holding an exchange id would again be enough to self-join and read the assignments.',
      v_exchange_ins;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 3. The general form of the class. Postgres reuses USING as the check when
  --    WITH CHECK is omitted, so any column absent from USING is freely
  --    rewritable -- which is how all three escalations above began.
  ---------------------------------------------------------------------------
  select count(*) into v_update_open
    from pg_policies
   where schemaname = 'public'
     and cmd = 'UPDATE'
     and with_check is null;

  if v_update_open <> 0 then
    raise exception
      'WRITE PATH: % UPDATE policy/policies in schema public have no WITH CHECK. Postgres then reuses USING as the check, leaving every column absent from USING freely rewritable.',
      v_update_open;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Population control: assertion 3 is "count is zero", which a schema with no
  -- UPDATE policies at all would satisfy trivially.
  ---------------------------------------------------------------------------
  select count(*) into v_update_total
    from pg_policies
   where schemaname = 'public'
     and cmd = 'UPDATE';

  if v_update_total < 16 then
    raise exception
      'CONTROL FAIL: only % UPDATE policy/policies found in schema public, expected at least 16. Policies have gone missing, so the WITH CHECK assertion above proves nothing.',
      v_update_total;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 4 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 4. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_07_write_path_defences');
end $$;

select token as result from _harness_result;
