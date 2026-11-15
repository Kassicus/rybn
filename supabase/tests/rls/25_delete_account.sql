-- 20261114000000_delete_account.sql: three foreign keys to user_profiles
-- given an on-delete action (invitations.invited_by on delete cascade;
-- group_gifts.target_user_id and gift_exchange_participants.assigned_to on
-- delete set null); delete_account(), which deletes the caller's account and
-- hands each group they own to the member who has been there longest; and no
-- policy that lets a signed-in person delete their profile row directly.
-- This file proves:
--
--   1. The foreign keys (assertions 1-3). Each column has exactly one foreign
--      key on it alone, to user_profiles, with the new on-delete action.
--   2. A profile row is deleted only through delete_account() (assertion 4):
--      user_profiles has no DELETE or ALL policy, among policies that exist.
--   3. The function (assertions 5-9). It takes no argument, so nobody can
--      name someone else; it returns void; it is SECURITY DEFINER with
--      search_path pinned. authenticated may execute it, and neither anon
--      nor service_role may, with no grant to PUBLIC. Its deployed
--      definition holds no block comment and names neither the wishlist
--      items table nor the bought flag (a claim goes by its own cascade, and
--      an item the caller bought stays bought). It takes the caller from
--      requesting_user_id() and refuses a signed-out call with 28000 before
--      its first write, and it locks the groups it visits (for update of g)
--      before it changes a role or deletes a group.
--   4. The fixture (assertion 10). gone owns G1, G2, G3 and G6, is a member
--      of G4 (made by gone long ago, owned by owner4 now) and an admin of G7
--      (a group with no owner), and has left G5 (made by gone, owned by
--      left5 now).
--   5. Before the call, gone's own direct delete of their profile row
--      deletes nothing and the row is still there (assertion 11).
--   6. One call by gone (assertions 12-28). G1 passes to admin1 (an admin
--      before a member, then the longest-standing admin); G2 to m_early (the
--      longest-standing member); G3, with nobody else in it, is deleted with
--      its date and invitation. G4 stays owner4's and now names owner4 as
--      its maker; gone's invitation there goes and owner4's stays. The group
--      gift gone made there for owner4 goes to other4, the longest-standing
--      member who is not the person it is for; the one for gone stays for no
--      one. G6 passes to pair6, and the group gift gone made there for pair6,
--      its only other member, is deleted. The exchange not yet held, and the
--      one with no date, are cleared to be drawn again; the one already held
--      keeps owner4's match, and other4's match to gone is cleared. G5,
--      which gone made and left, names left5 as its maker, and so do the
--      group gift and exchange gone made there. gone's claims are gone, so
--      owner4's item is claimable again, and the item gone bought stays
--      bought. owner4's tracker row for gone stays, as a typed name. G7
--      passes to other7, who stays a member. gone has no profile, no
--      membership and no item left.
--   7. A second call by gone, who now has no profile (assertion 29), raises
--      nothing and changes nothing in the groups this file made.
--
-- A SIGNED-OUT CALL IS NOT ATTEMPTED LIVE. It raises 28000, and one uncaught
-- raise ends the whole batch this file is sent as; the runner bans handlers
-- file-wide. It is held by line-anchored checks of the deployed definition
-- (assertion 8), with the no-block-comment floor beneath them (assertion 7),
-- and a check that the refusal comes before the first write.
--
-- THE DIRECT DELETE IS ATTEMPTED LIVE (assertion 11), because it does not
-- raise: authenticated holds DELETE on every public table (the baseline's
-- grant), so with no delete policy the statement runs and row-level security
-- leaves it no row. Assertion 4 runs first, so a delete policy that came
-- back fails there, by name, before this statement is sent.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. delete_account() is called as the
-- signed-in gone, as the website calls it: request.jwt.claims and role are
-- set around each call and around the direct delete, and `role` goes back to
-- the captured current_user before every catalog read and every read that
-- verifies a write. The direct delete reads its row_count. now() is one value
-- for the whole transaction, so every joined_at is written out.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role     text;
  v_checks        int := 0;
  v_gone          text := 'user_dacc_gone';
  v_early         text := 'user_dacc_early';
  v_admin1        text := 'user_dacc_admin1';
  v_admin2        text := 'user_dacc_admin2';
  v_m_early       text := 'user_dacc_m_early';
  v_m_late        text := 'user_dacc_m_late';
  v_owner4        text := 'user_dacc_owner4';
  v_other4        text := 'user_dacc_other4';
  v_left5         text := 'user_dacc_left5';
  v_pair6         text := 'user_dacc_pair6';
  v_other7        text := 'user_dacc_other7';
  v_g1            uuid;
  v_g2            uuid;
  v_g3            uuid;
  v_g4            uuid;
  v_g5            uuid;
  v_g6            uuid;
  v_g7            uuid;
  v_made          uuid;
  v_for           uuid;
  v_only          uuid;
  v_left_gift     uuid;
  v_soon          uuid;
  v_held          uuid;
  v_undated       uuid;
  v_left_draw     uuid;
  v_claimed       uuid;
  v_bought        uuid;
  v_mine          uuid;
  v_tracker       uuid;
  v_count         int;
  v_count2        int;
  v_count3        int;
  v_count4        int;
  v_count5        int;
  v_count6        int;
  -- A block-comment opener, built so this file holds none itself.
  v_block_open    text := '/' || '*';
  v_def           text;
  v_pos_refusal   int;
  v_pos_lock      int;
  v_pos_role      int;
  v_pos_delete    int;
  v_nargs         int;
  v_rettype       regtype;
  v_secdef        boolean;
  v_config        text[];
  v_can_authed    boolean;
  v_can_anon      boolean;
  v_can_service   boolean;
  v_acl_set       boolean;
  v_public_exec   boolean;
  v_role          text;
  v_role2         text;
  v_role3         text;
  v_created_by    text;
  v_created_by2   text;
  v_target        text;
  v_generated     boolean;
  v_assigned      text;
  v_assigned2     text;
  v_bought_flag   boolean;
  v_person        text;
  v_fp1           text;
  v_fp2           text;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_gone,    'daccgone',   'Dacc Gone'),
           (v_early,   'daccearly',  'Dacc Early'),
           (v_admin1,  'daccadmin1', 'Dacc Admin1'),
           (v_admin2,  'daccadmin2', 'Dacc Admin2'),
           (v_m_early, 'daccmearly', 'Dacc M Early'),
           (v_m_late,  'daccmlate',  'Dacc M Late'),
           (v_owner4,  'daccowner4', 'Dacc Owner4'),
           (v_other4,  'daccother4', 'Dacc Other4'),
           (v_left5,   'daccleft',   'Dacc Left5'),
           (v_pair6,   'daccpair',   'Dacc Pair6'),
           (v_other7,  'daccother7', 'Dacc Other7');

  -- Every group is made by gone, so add_group_creator_as_owner() makes gone
  -- its owner (joined now()).
  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Admins', 'custom', 'DACCADM1', v_gone)
    returning id into v_g1;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Members', 'custom', 'DACCMEM1', v_gone)
    returning id into v_g2;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Alone', 'custom', 'DACCALN1', v_gone)
    returning id into v_g3;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Old', 'custom', 'DACCOLD1', v_gone)
    returning id into v_g4;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Left', 'custom', 'DACCLFT1', v_gone)
    returning id into v_g5;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Pair', 'custom', 'DACCPAR1', v_gone)
    returning id into v_g6;

  insert into groups (name, type, invite_code, created_by)
    values ('Dacc Ownerless', 'custom', 'DACCOWN1', v_gone)
    returning id into v_g7;

  -- G1: early is the longest-standing, but a member; admin1 is the
  -- longer-standing of the two admins. G2: m_early joined before m_late
  -- although inserted after. G4: owner4 owns it. G5: left5 owns it. G6:
  -- pair6 alone besides gone. G7: other7 alone besides gone.
  insert into group_members (group_id, user_id, role, joined_at)
    values (v_g1, v_early,   'member', now() - interval '300 days'),
           (v_g1, v_admin1,  'admin',  now() - interval '200 days'),
           (v_g1, v_admin2,  'admin',  now() - interval '100 days'),
           (v_g2, v_m_late,  'member', now() - interval '100 days'),
           (v_g2, v_m_early, 'member', now() - interval '200 days'),
           (v_g4, v_owner4,  'owner',  now() - interval '400 days'),
           (v_g4, v_other4,  'member', now() - interval '50 days'),
           (v_g5, v_left5,   'owner',  now() - interval '150 days'),
           (v_g6, v_pair6,   'member', now() - interval '100 days'),
           (v_g7, v_other7,  'member', now() - interval '20 days');

  -- gone made G4 long ago and is no longer its owner (Review Focus 1), and
  -- G7 has no owner at all (a role changed by hand).
  update group_members
     set role = 'member'
   where group_id = v_g4 and user_id = v_gone;

  update group_members
     set role = 'admin'
   where group_id = v_g7 and user_id = v_gone;

  -- gone made G5 and has left it: only created_by, a group gift and an
  -- exchange gone made there bring the call to it.
  delete from group_members
   where group_id = v_g5 and user_id = v_gone;

  -- G3's date, made by gone.
  insert into occasions (group_id, kind, name, occasion_date, created_by)
    values (v_g3, 'group_date', 'Dacc Day', current_date + 30, v_gone);

  -- gone's invitation to G3, gone's and owner4's to G4.
  insert into invitations (group_id, email, invited_by, token, expires_at)
    values (v_g3, 'alone@example.com',  v_gone,   'dacc_inv_alone',  now() + interval '7 days'),
           (v_g4, 'friend@example.com', v_gone,   'dacc_inv_gone',   now() + interval '7 days'),
           (v_g4, 'pal@example.com',    v_owner4, 'dacc_inv_owner4', now() + interval '7 days');

  -- In G4: a group gift gone made for owner4, and one owner4 made for gone.
  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc Made', v_owner4, v_gone)
    returning id into v_made;

  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g4, 'Dacc For', v_gone, v_owner4)
    returning id into v_for;

  -- In G5: a group gift gone made for nobody.
  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g5, 'Dacc Left Gift', null, v_gone)
    returning id into v_left_gift;

  -- In G6: a group gift gone made for pair6, G6's only other member.
  insert into group_gifts (group_id, name, target_user_id, created_by)
    values (v_g6, 'Dacc Only', v_pair6, v_gone)
    returning id into v_only;

  -- In G4: an exchange gone made, not yet held; one owner4 made, already
  -- held; and one owner4 made with no date. All three drawn:
  -- gone -> owner4 -> other4 -> gone.
  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g4, 'Dacc Soon', now() + interval '30 days', true, v_gone)
    returning id into v_soon;

  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g4, 'Dacc Held', now() - interval '30 days', true, v_owner4)
    returning id into v_held;

  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g4, 'Dacc Undated', null, true, v_owner4)
    returning id into v_undated;

  insert into gift_exchange_participants (exchange_id, user_id, assigned_to)
    values (v_soon,    v_gone,   v_owner4),
           (v_soon,    v_owner4, v_other4),
           (v_soon,    v_other4, v_gone),
           (v_held,    v_gone,   v_owner4),
           (v_held,    v_owner4, v_other4),
           (v_held,    v_other4, v_gone),
           (v_undated, v_gone,   v_owner4),
           (v_undated, v_owner4, v_other4),
           (v_undated, v_other4, v_gone);

  -- In G5: an exchange gone made, not drawn, with gone not in it.
  insert into gift_exchanges (group_id, name, exchange_date, assignments_generated, created_by)
    values (v_g5, 'Dacc Left Draw', now() + interval '30 days', false, v_gone)
    returning id into v_left_draw;

  -- Outside the groups: owner4's two items, each claimed by gone (one of
  -- them bought), gone's own item, and owner4's tracker row for gone.
  insert into wishlist_items (user_id, title, purchased)
    values (v_owner4, 'Dacc Claimed', false)
    returning id into v_claimed;

  insert into wishlist_items (user_id, title, purchased)
    values (v_owner4, 'Dacc Bought', true)
    returning id into v_bought;

  insert into wishlist_items (user_id, title)
    values (v_gone, 'Dacc Mine')
    returning id into v_mine;

  insert into wishlist_claims (item_id, occasion_id, claimed_by)
    values (v_claimed, null, v_gone),
           (v_bought,  null, v_gone);

  insert into gift_recipients (user_id, name, person_id)
    values (v_owner4, 'Dacc Gone', v_gone)
    returning id into v_tracker;

  ---------------------------------------------------------------------------
  -- Assertion 1: invitations.invited_by has exactly one foreign key on it
  -- alone, to user_profiles, on delete cascade (confdeltype 'c'): an
  -- invitation goes with the person who sent it.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'c')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.invitations'::regclass
     and c.contype = 'f'
     and a.attname = 'invited_by'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: invitations.invited_by has % foreign key(s) on it alone, % of them to user_profiles on delete cascade; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: group_gifts.target_user_id has exactly one foreign key on
  -- it alone, to user_profiles, on delete set null (confdeltype 'n').
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'n')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.group_gifts'::regclass
     and c.contype = 'f'
     and a.attname = 'target_user_id'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: group_gifts.target_user_id has % foreign key(s) on it alone, % of them to user_profiles on delete set null; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: gift_exchange_participants.assigned_to has exactly one
  -- foreign key on it alone, to user_profiles, on delete set null
  -- (confdeltype 'n').
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'n')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.gift_exchange_participants'::regclass
     and c.contype = 'f'
     and a.attname = 'assigned_to'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: gift_exchange_participants.assigned_to has % foreign key(s) on it alone, % of them to user_profiles on delete set null; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: user_profiles has no DELETE or ALL policy, so a signed-in
  -- person cannot delete their profile row directly; delete_account(), which
  -- runs as its owner, is the only way. Its other policies are there, so
  -- the zero is read from a table this query finds.
  ---------------------------------------------------------------------------
  select count(*) filter (where cmd in ('DELETE', 'ALL')),
         count(*)
    into v_count, v_count2
    from pg_policies
   where schemaname = 'public'
     and tablename = 'user_profiles';

  if v_count <> 0 or v_count2 < 1 then
    raise exception
      'GUARD FAIL: user_profiles has % DELETE or ALL polic(y/ies) among % in all; expected 0 among at least 1 -- a profile row is deleted only through delete_account()',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: delete_account() takes no argument (nobody can name
  -- someone else), returns void, and is SECURITY DEFINER with search_path
  -- pinned.
  ---------------------------------------------------------------------------
  select p.pronargs, p.prorettype::regtype, p.prosecdef, p.proconfig
    into v_nargs, v_rettype, v_secdef, v_config
    from pg_proc p
   where p.oid = 'public.delete_account()'::regprocedure;

  if v_nargs is distinct from 0
     or v_rettype is distinct from 'void'::regtype
     or v_secdef is distinct from true
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: delete_account has pronargs %, return type %, prosecdef % and proconfig %; expected 0 arguments, void, prosecdef true and search_path=public among proconfig',
      v_nargs, v_rettype, v_secdef, v_config;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: authenticated may execute it; anon and service_role may
  -- not; and its ACL is set and grants PUBLIC (grantee 0) no EXECUTE.
  ---------------------------------------------------------------------------
  select has_function_privilege('authenticated', 'public.delete_account()', 'execute'),
         has_function_privilege('anon', 'public.delete_account()', 'execute'),
         has_function_privilege('service_role', 'public.delete_account()', 'execute')
    into v_can_authed, v_can_anon, v_can_service;

  select p.proacl is not null,
         exists (select 1
                   from aclexplode(p.proacl) x
                  where x.grantee = 0
                    and x.privilege_type = 'EXECUTE')
    into v_acl_set, v_public_exec
    from pg_proc p
   where p.oid = 'public.delete_account()'::regprocedure;

  if v_can_authed is distinct from true or v_can_anon is distinct from false
     or v_can_service is distinct from false
     or v_acl_set is distinct from true or v_public_exec is distinct from false then
    raise exception
      'GUARD FAIL: delete_account is executable by authenticated: %, anon: %, service_role: %; its ACL is set: % and grants PUBLIC EXECUTE: %; expected true, false, false, true and false',
      v_can_authed, v_can_anon, v_can_service, v_acl_set, v_public_exec;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: its definition holds no block comment (the floor beneath
  -- assertions 8 and 9) and names neither the wishlist items table nor the
  -- bought flag: a claim goes by its own cascade, and an item the caller
  -- bought stays bought.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.delete_account()'::regprocedure);

  if position(v_block_open in v_def) <> 0
     or position('wishlist_items' in v_def) <> 0
     or position('purchased' in v_def) <> 0 then
    raise exception
      'GUARD FAIL: delete_account''s definition has a block comment at character %, names wishlist_items at character % and purchased at character %; expected 0 for all three',
      position(v_block_open in v_def), position('wishlist_items' in v_def),
      position('purchased' in v_def);
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: it takes the caller from requesting_user_id() and refuses
  -- a signed-out call with 28000, each on a line of its own (so not
  -- line-commented), and the refusal comes before it changes a role and
  -- before it deletes a group.
  ---------------------------------------------------------------------------
  v_pos_refusal := position('raise exception ''not authenticated'' using errcode = ''28000'';' in v_def);
  v_pos_role := position('update group_members' in v_def);
  v_pos_delete := position('delete from groups' in v_def);

  if not v_def ~ '(?n)^\s*v_caller text := \(select public\.requesting_user_id\(\)\);$'
     or not v_def ~ '(?n)^\s*if v_caller is null then$'
     or not v_def ~ '(?n)^\s*raise exception ''not authenticated'' using errcode = ''28000'';$'
     or v_pos_refusal = 0 or v_pos_role = 0 or v_pos_delete = 0
     or v_pos_refusal > v_pos_role or v_pos_refusal > v_pos_delete then
    raise exception
      'GUARD FAIL: delete_account no longer takes the caller from requesting_user_id() and refuses a signed-out call with 28000 before its first write, not line-commented (refusal at character %, role change at %, group delete at %; expected all three present, the refusal first)',
      v_pos_refusal, v_pos_role, v_pos_delete;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: the query that finds the groups locks them (for update of
  -- g, on a line of its own, so not line-commented), before it changes a
  -- role or deletes a group: a join, or another member deleting their
  -- account, waits for this call.
  ---------------------------------------------------------------------------
  v_pos_lock := position('for update of g' in v_def);

  if not v_def ~ '(?n)^\s*for update of g$'
     or v_pos_lock = 0 or v_pos_role = 0 or v_pos_delete = 0
     or v_pos_lock > v_pos_role or v_pos_lock > v_pos_delete then
    raise exception
      'GUARD FAIL: delete_account no longer locks the groups it visits before it writes, not line-commented (lock at character %, role change at %, group delete at %; expected all three present, the lock first)',
      v_pos_lock, v_pos_role, v_pos_delete;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: before the call, the fixture is what the rest of this
  -- file assumes. gone is owner of G1, G2, G3 and G6, member of G4 and
  -- admin of G7, in six groups in all; G7 has no owner; gone has no member
  -- row in G5, and left5 owns it.
  ---------------------------------------------------------------------------
  select count(*) filter (where gm.group_id in (v_g1, v_g2, v_g3, v_g6) and gm.role = 'owner'),
         count(*) filter (where gm.group_id = v_g4 and gm.role = 'member'),
         count(*) filter (where gm.group_id = v_g7 and gm.role = 'admin'),
         count(*) filter (where gm.group_id = v_g5),
         count(*)
    into v_count, v_count2, v_count3, v_count6, v_count4
    from group_members gm
   where gm.user_id = v_gone;

  select count(*) into v_count5
    from group_members gm
   where gm.group_id = v_g7
     and gm.role = 'owner';

  select gm.role::text into v_role
    from group_members gm
   where gm.group_id = v_g5
     and gm.user_id = v_left5;

  if v_count <> 4 or v_count2 <> 1 or v_count3 <> 1 or v_count4 <> 6 or v_count5 <> 0
     or v_count6 <> 0 or v_role is distinct from 'owner' then
    raise exception
      'DELETE FAIL: before the call % is owner of % of G1, G2, G3 and G6 (expected 4), member of G4 in % row(s) (expected 1), admin of G7 in % row(s) (expected 1), in % group(s) in all (expected 6), with % row(s) in G5 (expected 0); G7 has % owner(s) (expected 0) and % is % in G5 (expected owner) -- the call below would prove nothing',
      v_gone, v_count, v_count2, v_count3, v_count4, v_count6, v_count5, v_left5, v_role;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: gone's own direct delete of their profile row deletes
  -- nothing (there is no delete policy, so row-level security leaves it no
  -- row), and the row is still there.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_dacc_gone","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  delete from public.user_profiles where id = 'user_dacc_gone';
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count2
    from user_profiles
   where id = v_gone;

  if v_count <> 0 or v_count2 <> 1 then
    raise exception
      'GUARD FAIL: % deleting their own profile row directly deleted % row(s), and % row(s) of it remain; expected 0 deleted and 1 remaining -- a profile row is deleted only through delete_account()',
      v_gone, v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- gone deletes their account.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_dacc_gone","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.delete_account();

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 12: G1 passes to admin1. An admin comes before a member, and
  -- of the two admins admin1 has been there longer. admin2 stays admin,
  -- early stays member, and G1 has exactly one owner.
  ---------------------------------------------------------------------------
  select (select gm.role::text from group_members gm
           where gm.group_id = v_g1 and gm.user_id = v_admin1),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g1 and gm.user_id = v_admin2),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g1 and gm.user_id = v_early),
         (select count(*) from group_members gm
           where gm.group_id = v_g1 and gm.role = 'owner')
    into v_role, v_role2, v_role3, v_count;

  if v_role is distinct from 'owner' or v_role2 is distinct from 'admin'
     or v_role3 is distinct from 'member' or v_count <> 1 then
    raise exception
      'DELETE FAIL: in G1 % is %, % is % and % is %, with % owner(s); expected owner, admin, member and exactly 1 owner (an admin before a member, then the longest-standing)',
      v_admin1, v_role, v_admin2, v_role2, v_early, v_role3, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 13: G2 passes to m_early, the longer-standing of two members;
  -- m_late stays member.
  ---------------------------------------------------------------------------
  select (select gm.role::text from group_members gm
           where gm.group_id = v_g2 and gm.user_id = v_m_early),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g2 and gm.user_id = v_m_late)
    into v_role, v_role2;

  if v_role is distinct from 'owner' or v_role2 is distinct from 'member' then
    raise exception
      'DELETE FAIL: in G2 % is % and % is %; expected owner and member (the longest-standing member becomes owner)',
      v_m_early, v_role, v_m_late, v_role2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 14: G3, with nobody but gone in it, is deleted, and its date
  -- and gone's invitation to it go by their cascades.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from groups
   where id = v_g3;

  select count(*) into v_count2
    from occasions
   where group_id = v_g3;

  select count(*) into v_count3
    from invitations
   where token = 'dacc_inv_alone';

  if v_count <> 0 or v_count2 <> 0 or v_count3 <> 0 then
    raise exception
      'DELETE FAIL: G3 has % groups row(s), % occasions row(s) and % invitation(s) with token dacc_inv_alone; expected 0 of each',
      v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 15: (Review Focus 1, a group made long ago by someone who is
  -- no longer its owner) G4 stays, now names owner4 as its maker, owner4 is
  -- still owner and other4 still member, and gone has no member row in it.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from groups
   where id = v_g4;

  select (select gm.role::text from group_members gm
           where gm.group_id = v_g4 and gm.user_id = v_owner4),
         (select gm.role::text from group_members gm
           where gm.group_id = v_g4 and gm.user_id = v_other4),
         (select count(*) from group_members gm
           where gm.group_id = v_g4 and gm.user_id = v_gone)
    into v_role, v_role2, v_count2;

  if v_count <> 1 or v_created_by is distinct from v_owner4
     or v_role is distinct from 'owner' or v_role2 is distinct from 'member'
     or v_count2 <> 0 then
    raise exception
      'DELETE FAIL: G4 has % groups row(s) made by %, % is %, % is %, and % has % member row(s) in it; expected 1 row made by %, owner, member and 0 rows',
      v_count, v_created_by, v_owner4, v_role, v_other4, v_role2, v_gone, v_count2, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 16: (Review Focus 1, the invitation the caller sent) no
  -- invitation anywhere names gone as its sender, and owner4's is still
  -- there.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from invitations
   where invited_by = v_gone;

  select count(*) into v_count2
    from invitations
   where token = 'dacc_inv_owner4'
     and invited_by = v_owner4;

  if v_count <> 0 or v_count2 <> 1 then
    raise exception
      'DELETE FAIL: % invitation(s) name % as sender, and % invitation(s) with token dacc_inv_owner4 by % remain; expected 0 and 1',
      v_count, v_gone, v_count2, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 17: the group gift gone made for owner4, Dacc Made, now names
  -- other4 as its maker: the longest-standing member who is neither the
  -- caller nor the person it is for (owner4, G4's heir, is the person it is
  -- for).
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from group_gifts
   where id = v_made;

  if v_count <> 1 or v_created_by is distinct from v_other4 then
    raise exception
      'DELETE FAIL: Dacc Made has % row(s) made by %; expected 1 row made by % (not %, the person it is for)',
      v_count, v_created_by, v_other4, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 18: the group gift gone made for pair6, Dacc Only, is deleted,
  -- since pair6, the person it is for, is G6's only other member; G6 stays,
  -- names pair6 as its maker, and pair6 owns it.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from group_gifts
   where id = v_only;

  select count(*), max(created_by) into v_count2, v_created_by
    from groups
   where id = v_g6;

  select gm.role::text into v_role
    from group_members gm
   where gm.group_id = v_g6
     and gm.user_id = v_pair6;

  if v_count <> 0 or v_count2 <> 1 or v_created_by is distinct from v_pair6
     or v_role is distinct from 'owner' then
    raise exception
      'DELETE FAIL: Dacc Only has % row(s) (expected 0: its only other member is the person it is for); G6 has % groups row(s) made by %, and % is % in it; expected 1 row made by % and owner',
      v_count, v_count2, v_created_by, v_pair6, v_role, v_pair6;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 19: the group gift for gone, Dacc For, stays, for no one, and
  -- still names owner4 as its maker.
  ---------------------------------------------------------------------------
  select count(*), max(target_user_id), max(created_by)
    into v_count, v_target, v_created_by
    from group_gifts
   where id = v_for;

  if v_count <> 1 or v_target is not null or v_created_by is distinct from v_owner4 then
    raise exception
      'DELETE FAIL: Dacc For has % row(s) for % made by %; expected 1 row for no one (null) made by %',
      v_count, v_target, v_created_by, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 20: the exchange not yet held, Dacc Soon, now names owner4 as
  -- its maker and is no longer drawn: owner4's and other4's rows remain,
  -- both with no match.
  ---------------------------------------------------------------------------
  select max(created_by), bool_and(assignments_generated)
    into v_created_by, v_generated
    from gift_exchanges
   where id = v_soon;

  select count(*),
         count(*) filter (where user_id in (v_owner4, v_other4)),
         count(*) filter (where assigned_to is null)
    into v_count, v_count2, v_count3
    from gift_exchange_participants
   where exchange_id = v_soon;

  if v_created_by is distinct from v_owner4 or v_generated is distinct from false
     or v_count <> 2 or v_count2 <> 2 or v_count3 <> 2 then
    raise exception
      'DELETE FAIL: Dacc Soon is made by % with assignments_generated %, and has % participant row(s), % of them owner4''s or other4''s and % with no match; expected made by %, false, and 2, 2 and 2',
      v_created_by, v_generated, v_count, v_count2, v_count3, v_owner4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 21: the exchange already held, Dacc Held, stays drawn: two
  -- rows remain, owner4's match is still other4, and other4's match to gone
  -- is cleared.
  ---------------------------------------------------------------------------
  select bool_and(assignments_generated) into v_generated
    from gift_exchanges
   where id = v_held;

  select count(*),
         max(assigned_to) filter (where user_id = v_owner4),
         max(assigned_to) filter (where user_id = v_other4),
         count(*) filter (where user_id = v_other4)
    into v_count, v_assigned, v_assigned2, v_count2
    from gift_exchange_participants
   where exchange_id = v_held;

  if v_generated is distinct from true or v_count <> 2
     or v_assigned is distinct from v_other4
     or v_count2 <> 1 or v_assigned2 is not null then
    raise exception
      'DELETE FAIL: Dacc Held has assignments_generated % and % participant row(s); owner4''s match is % and other4 has % row(s) matched to %; expected true, 2 rows, %, and 1 row with no match (null)',
      v_generated, v_count, v_assigned, v_count2, v_assigned2, v_other4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 22: the exchange with no date, Dacc Undated, counts as not yet
  -- held: it is no longer drawn, and owner4's and other4's rows remain, both
  -- with no match.
  ---------------------------------------------------------------------------
  select bool_and(assignments_generated) into v_generated
    from gift_exchanges
   where id = v_undated;

  select count(*),
         count(*) filter (where user_id in (v_owner4, v_other4)),
         count(*) filter (where assigned_to is null)
    into v_count, v_count2, v_count3
    from gift_exchange_participants
   where exchange_id = v_undated;

  if v_generated is distinct from false
     or v_count <> 2 or v_count2 <> 2 or v_count3 <> 2 then
    raise exception
      'DELETE FAIL: Dacc Undated has assignments_generated % and % participant row(s), % of them owner4''s or other4''s and % with no match; expected false, and 2, 2 and 2 (no date counts as not yet held)',
      v_generated, v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 23: (Review Focus 1, a group made by someone who has left it)
  -- G5 stays, names left5 as its maker, and left5 is still its owner and
  -- its only member; the group gift and the exchange gone made there name
  -- left5 as their maker.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from groups
   where id = v_g5;

  select count(*), max(gm.role::text) filter (where gm.user_id = v_left5)
    into v_count2, v_role
    from group_members gm
   where gm.group_id = v_g5;

  select max(created_by) into v_created_by2
    from group_gifts
   where id = v_left_gift;

  select max(created_by) into v_person
    from gift_exchanges
   where id = v_left_draw;

  if v_count <> 1 or v_created_by is distinct from v_left5
     or v_count2 <> 1 or v_role is distinct from 'owner'
     or v_created_by2 is distinct from v_left5 or v_person is distinct from v_left5 then
    raise exception
      'DELETE FAIL: G5 has % groups row(s) made by %, % member row(s) with % as %; Dacc Left Gift is made by % and Dacc Left Draw by %; expected 1 row made by %, 1 member row with % as owner, and both made by %',
      v_count, v_created_by, v_count2, v_left5, v_role, v_created_by2, v_person,
      v_left5, v_left5, v_left5;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 24: Dacc Claimed has no claim left on it, and no claim
  -- anywhere names gone: the item is claimable again.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from wishlist_claims
   where item_id = v_claimed;

  select count(*) into v_count2
    from wishlist_claims
   where claimed_by = v_gone;

  if v_count <> 0 or v_count2 <> 0 then
    raise exception
      'DELETE FAIL: Dacc Claimed has % claim(s) on it, and % claim(s) name % anywhere; expected 0 and 0',
      v_count, v_count2, v_gone;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 25: Dacc Bought, which gone bought, stays, and stays bought.
  ---------------------------------------------------------------------------
  select count(*), bool_and(purchased) into v_count, v_bought_flag
    from wishlist_items
   where id = v_bought;

  if v_count <> 1 or v_bought_flag is distinct from true then
    raise exception
      'DELETE FAIL: Dacc Bought has % row(s) with purchased %; expected 1 row with purchased true',
      v_count, v_bought_flag;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 26: owner4's tracker row Dacc Gone stays, tied to nobody (a
  -- typed name now).
  ---------------------------------------------------------------------------
  select count(*), max(person_id) into v_count, v_person
    from gift_recipients
   where id = v_tracker;

  if v_count <> 1 or v_person is not null then
    raise exception
      'DELETE FAIL: owner4''s tracker row Dacc Gone has % row(s) tied to %; expected 1 row tied to nobody (null)',
      v_count, v_person;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 27: G7, which had no owner, stays and now names other7 (its
  -- only other member) as its maker; other7 is still a member.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from groups
   where id = v_g7;

  select gm.role::text into v_role
    from group_members gm
   where gm.group_id = v_g7
     and gm.user_id = v_other7;

  if v_count <> 1 or v_created_by is distinct from v_other7
     or v_role is distinct from 'member' then
    raise exception
      'DELETE FAIL: G7 has % groups row(s) made by %, and % is %; expected 1 row made by % and member',
      v_count, v_created_by, v_other7, v_role, v_other7;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 28: gone has no profile, no membership and no item left.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from user_profiles
   where id = v_gone;

  select count(*) into v_count2
    from group_members
   where user_id = v_gone;

  select count(*) into v_count3
    from wishlist_items
   where id = v_mine;

  if v_count <> 0 or v_count2 <> 0 or v_count3 <> 0 then
    raise exception
      'DELETE FAIL: % has % user_profiles row(s), % group_members row(s) and % Dacc Mine item(s) left; expected 0 of each',
      v_gone, v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- gone, now with no profile, calls again. Each group this file made, its
  -- maker and each member's role, in a fixed order, before and after.
  ---------------------------------------------------------------------------
  select string_agg(g.name || '/' || g.created_by || '/' || coalesce(m.members, ''),
                    '|' order by g.name, g.id)
    into v_fp1
    from groups g
    left join lateral (
      select string_agg(gm.user_id || '=' || coalesce(gm.role::text, 'none'),
                        ',' order by gm.user_id) as members
        from group_members gm
       where gm.group_id = g.id
    ) m on true
   where g.name like 'Dacc %';

  perform set_config('request.jwt.claims',
    '{"sub":"user_dacc_gone","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.delete_account();

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 29: the second call, by a caller with no profile, raised
  -- nothing (this line is reached) and changed nothing.
  ---------------------------------------------------------------------------
  select string_agg(g.name || '/' || g.created_by || '/' || coalesce(m.members, ''),
                    '|' order by g.name, g.id)
    into v_fp2
    from groups g
    left join lateral (
      select string_agg(gm.user_id || '=' || coalesce(gm.role::text, 'none'),
                        ',' order by gm.user_id) as members
        from group_members gm
       where gm.group_id = g.id
    ) m on true
   where g.name like 'Dacc %';

  if v_fp1 is null or v_fp2 is distinct from v_fp1 then
    raise exception
      'DELETE FAIL: after a second call by %, who has no profile, the groups this file made read % (before it: %); expected the same, and not null',
      v_gone, v_fp2, v_fp1;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 29 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 29', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_25_delete_account');
end $$;

select token as result from _harness_result;
