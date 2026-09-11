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
  v_gm_insert     int;
  v_pin           int;
  v_inv_upd       int;
  v_occ_upd       int;
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
  --      group_members              -> rewriting user_id let an owner/admin
  --                                    conscript an arbitrary Clerk id into
  --                                    their group and read everything that
  --                                    user shares with that group type
  --      invitations               -> repointing group_id after insert let an
  --                                    attacker invite themselves to a
  --                                    throwaway group, aim the row at a
  --                                    victim group, and redeem their own
  --                                    token through accept_group_invitation()
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

  if v_update_total < 15 then
    raise exception
      'CONTROL FAIL: only % UPDATE policy/policies found in schema public, expected at least 15. Policies have gone missing, so the WITH CHECK assertion above proves nothing.',
      v_update_total;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 3b. and 3c. The two pins added after accept_group_invitation() existed.
  --     They get their own assertions rather than two more rows in the list
  --     above, because a loop over a VALUES list is ONE increment: the counter
  --     cannot tell five names from three, so entries could be dropped from it
  --     silently. One increment per guarantee is what makes the floor mean
  --     something.
  ---------------------------------------------------------------------------
  select count(*) into v_pin
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
   where n.nspname = 'public' and c.relname = 'group_members'
     and not tg.tgisinternal and tg.tgenabled = 'O'
     and p.proname = 'reject_parent_reassignment';

  if v_pin <> 1 then
    raise exception
      'WRITE PATH: group_members has no enabled reject_parent_reassignment trigger. Without it an owner or admin can rewrite a membership row''s user_id and conscript an arbitrary Clerk user into their group.';
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_pin
    from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = tg.tgfoid
   where n.nspname = 'public' and c.relname = 'invitations'
     and not tg.tgisinternal and tg.tgenabled = 'O'
     and p.proname = 'reject_parent_reassignment';

  if v_pin <> 1 then
    raise exception
      'WRITE PATH: invitations has no enabled reject_parent_reassignment trigger. Without it group_id is rewritable after insert, so an attacker invites themselves to a throwaway group, repoints the row at a victim group, and redeems their own token through accept_group_invitation().';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 3d. The invitations UPDATE policy must re-check group membership.
  --
  --     `invited_by = me` alone left a removed member in write control of
  --     every invitation they ever sent, SPENT ones included: un-accept a used
  --     invitation, roll expires_at forward, re-token it, redeem it -- or pass
  --     the fresh token to a stranger. The owner's obvious remedy, deleting
  --     the pending invitations, removes nothing, because the dangerous row is
  --     an accepted one.
  ---------------------------------------------------------------------------
  select count(*) into v_inv_upd
    from pg_policies
   where schemaname = 'public'
     and tablename = 'invitations'
     and cmd = 'UPDATE'
     and qual like '%is_group_member%'
     and with_check like '%is_group_member%';

  if v_inv_upd <> 1 then
    raise exception
      'WRITE PATH: the invitations UPDATE policy no longer re-checks is_group_member on both sides (matched % policy/policies, expected 1). A removed member would regain write control of every invitation they ever sent, including spent ones.',
      v_inv_upd;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 3e. The occasions UPDATE policy must require membership in the NEW
  --     group_id, unconditionally -- not only inside the creator-or-admin OR.
  --
  --     The shipped policy's WITH CHECK was `kind = 'group_date' and
  --     (created_by = me or is_group_admin(group_id, me))`. Because the
  --     creator branch is an OR, it never re-tested the NEW group_id: a
  --     creator could `update occasions set group_id = <any group uuid>`
  --     and the check passed on `created_by = me` alone, is_group_admin()
  --     never reached. That planted a permanently-owned row, with arbitrary
  --     name/date, in the occasions feed of any group whose UUID the actor
  --     knew -- including one they were never a member of. Group UUIDs are
  --     not secret; they appear in the app's URLs.
  ---------------------------------------------------------------------------
  select count(*) into v_occ_upd
    from pg_policies
   where schemaname = 'public'
     and tablename = 'occasions'
     and cmd = 'UPDATE'
     and with_check like '%is_group_member%';

  if v_occ_upd <> 1 then
    raise exception
      'WRITE PATH: the occasions UPDATE policy no longer requires is_group_member on the NEW group_id (matched % policy/policies, expected 1). A creator could again repoint their row into any group whose UUID they knew and keep permanent write control over it there.',
      v_occ_upd;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 4. group_members must have NO INSERT policy at all.
  --
  --    Membership is the key to nearly everything in this schema --
  --    is_group_member() is the predicate under most of the policy set -- and
  --    the archived INSERT policy was `with check (requesting_user_id() =
  --    user_id)`, i.e. anyone holding a group id could grant it to themselves.
  --    A removed member could rejoin unaided, which made removal
  --    unenforceable. RLS cannot express the real rule (a policy cannot be
  --    handed an invite code to check), so membership is created only by
  --    join_group_with_code(), accept_group_invitation() and the
  --    add_group_creator_as_owner() trigger -- all SECURITY DEFINER, all
  --    unaffected by the absence of a policy. Any INSERT policy reappearing
  --    here reopens the whole thing.
  ---------------------------------------------------------------------------
  select count(*) into v_gm_insert
    from pg_policies
   where schemaname = 'public'
     and tablename = 'group_members'
     and cmd = 'INSERT';

  if v_gm_insert <> 0 then
    raise exception
      'WRITE PATH: group_members has % INSERT policy/policies, expected none. Membership must never be self-grantable: it may be created only by join_group_with_code(), accept_group_invitation() and the group-creation trigger.',
      v_gm_insert;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 9 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 9. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_07_write_path_defences');
end $$;

select token as result from _harness_result;
