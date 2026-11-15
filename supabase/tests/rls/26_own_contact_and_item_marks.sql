-- 20261115000000_own_contact_and_item_marks.sql: own_contact(), which
-- answers the caller's own email and email_preferences from user_profiles;
-- and visible_item_marks(), which answers, for the listed items the caller
-- can see and does not own, whether each is bought and who marked it out of
-- stock, for the items that carry a mark. This file proves:
--
--   1. own_contact (assertions 1-5). It takes no argument, so nobody can
--      name someone else, and returns a table of email text and
--      email_preferences jsonb; it is SECURITY DEFINER, stable and written
--      in SQL, with search_path pinned. authenticated may execute it, and
--      neither anon nor service_role may, with no grant to PUBLIC. owner and
--      giver, who share a family group, are each answered exactly one row:
--      their own email and email_preferences. ghost, an id with no profile,
--      is answered no row.
--   2. visible_item_marks, its shape (assertions 6-8). It takes one
--      argument, p_item_ids uuid[], and returns a table of item_id uuid,
--      purchased boolean and out_of_stock_marked_by text; it is SECURITY
--      DEFINER, stable and written in SQL, with search_path pinned. Its
--      deployed definition holds no block comment, and holds, each on lines
--      of its own, the three conditions of the policy "Users can view
--      wishlist items based on privacy": the caller is signed in, is not the
--      item's owner, and can see it by can_view_wishlist_item() with the
--      caller as the viewer. Executable as own_contact is.
--   3. The fixture (assertion 9). owner's A is bought, B is marked out of
--      stock by giver and C carries no mark, all three seen by giver; owner's
--      D is bought and seen by nobody but owner; giver's E is bought and
--      seen by owner. stranger, in no group, sees none of the five.
--   4. visible_item_marks, live (assertions 10-13). Asked about all five,
--      giver is answered A (bought, no marker) and B (not bought, marked by
--      giver) and nothing else; owner is answered E alone, nothing about
--      their own four; stranger is answered nothing. giver asking about C
--      alone, about an empty list or about a null list is answered nothing.
--
-- NO CALL HERE RAISES. A call by anon would (anon holds no EXECUTE), and one
-- uncaught raise ends the whole batch this file is sent as; the runner bans
-- handlers file-wide. So anon's and service_role's refusal is held by
-- has_function_privilege (assertions 2 and 8), and every call made live is
-- one that answers rows or none.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. Both functions are called as the
-- signed-in caller, as the website calls them: request.jwt.claims and role
-- are set around each call and around each read through row-level security,
-- and `role` goes back to the captured current_user before every catalog
-- read and every read as the connecting role.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role        text;
  v_checks           int := 0;
  v_owner            text := 'user_ocim_owner';
  v_giver            text := 'user_ocim_giver';
  v_stranger         text := 'user_ocim_stranger';
  v_ghost            text := 'user_ocim_ghost';
  v_owner_email      text := 'ocim.owner@example.test';
  v_giver_email      text := 'ocim.giver@example.test';
  v_stranger_email   text := 'ocim.stranger@example.test';
  v_owner_prefs      jsonb := '{"email_group_invites": true, "email_date_reminders": false, "email_gift_updates": true, "email_exchange_notifications": true, "email_marketing": false}';
  v_giver_prefs      jsonb := '{"email_group_invites": false, "email_date_reminders": true, "email_gift_updates": false, "email_exchange_notifications": true, "email_marketing": true}';
  v_stranger_prefs   jsonb := '{"email_group_invites": true, "email_date_reminders": true, "email_gift_updates": true, "email_exchange_notifications": false, "email_marketing": false}';
  v_family_only      jsonb := '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}';
  v_nobody           jsonb := '{"visibleToGroupTypes": [], "restrictToGroup": null}';
  v_group            uuid;
  v_a                uuid;
  v_b                uuid;
  v_c                uuid;
  v_d                uuid;
  v_e                uuid;
  v_ids              uuid[];
  v_count            int;
  v_count2           int;
  v_count3           int;
  v_count4           int;
  v_count5           int;
  v_seen             int;
  v_seen2            int;
  v_seen3            int;
  v_seen4            int;
  v_email            text;
  v_prefs            jsonb;
  v_answer           text;
  -- A block-comment opener, built so this file holds none itself.
  v_block_open       text := '/' || '*';
  v_def              text;
  v_signed_in        boolean;
  v_not_owner        boolean;
  v_can_view         boolean;
  v_nargs            int;
  v_args             text;
  v_result           text;
  v_secdef           boolean;
  v_volatile         text;
  v_lang             text;
  v_config           text[];
  v_can_authed       boolean;
  v_can_anon         boolean;
  v_can_service      boolean;
  v_acl_set          boolean;
  v_public_exec      boolean;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  -- Each profile has its own email and its own email_preferences, none of
  -- them the column's default. ghost has no profile.
  insert into user_profiles (id, username, display_name, email, email_preferences)
    values (v_owner,    'ocimowner',    'Ocim Owner',    v_owner_email,    v_owner_prefs),
           (v_giver,    'ocimgiver',    'Ocim Giver',    v_giver_email,    v_giver_prefs),
           (v_stranger, 'ocimstranger', 'Ocim Stranger', v_stranger_email, v_stranger_prefs);

  -- add_group_creator_as_owner() adds owner. giver joins, so owner and giver
  -- share a family group; stranger is in no group.
  insert into groups (name, type, invite_code, created_by)
    values ('Ocim Family', 'family', 'OCIMFAM1', v_owner)
    returning id into v_group;

  insert into group_members (group_id, user_id, role)
    values (v_group, v_giver, 'member')
    on conflict do nothing;

  -- owner's A (bought), B (marked out of stock by giver) and C (no mark),
  -- each seen by the family group; owner's D, bought and seen by no kind of
  -- group, so by nobody but owner (as 16_claim_visibility.sql's hidden
  -- item); and giver's E, bought and seen by the family group.
  insert into wishlist_items (user_id, title, privacy_settings, purchased)
    values (v_owner, 'Ocim A', v_family_only, true)
    returning id into v_a;

  insert into wishlist_items (user_id, title, privacy_settings, purchased,
                              out_of_stock_marked_by, out_of_stock_marked_at)
    values (v_owner, 'Ocim B', v_family_only, false, v_giver, now())
    returning id into v_b;

  insert into wishlist_items (user_id, title, privacy_settings, purchased)
    values (v_owner, 'Ocim C', v_family_only, false)
    returning id into v_c;

  insert into wishlist_items (user_id, title, privacy_settings, purchased)
    values (v_owner, 'Ocim D', v_nobody, true)
    returning id into v_d;

  insert into wishlist_items (user_id, title, privacy_settings, purchased)
    values (v_giver, 'Ocim E', v_family_only, true)
    returning id into v_e;

  v_ids := array[v_a, v_b, v_c, v_d, v_e];

  ---------------------------------------------------------------------------
  -- Assertion 1: own_contact() takes no argument (nobody can name someone
  -- else) and returns a table of email text and email_preferences jsonb; it
  -- is SECURITY DEFINER, stable and written in SQL, with search_path pinned.
  ---------------------------------------------------------------------------
  select p.pronargs, pg_get_function_result(p.oid), p.prosecdef,
         p.provolatile::text, l.lanname::text, p.proconfig
    into v_nargs, v_result, v_secdef, v_volatile, v_lang, v_config
    from pg_proc p
    join pg_language l on l.oid = p.prolang
   where p.oid = 'public.own_contact()'::regprocedure;

  if v_nargs is distinct from 0
     or v_result is distinct from 'TABLE(email text, email_preferences jsonb)'
     or v_secdef is distinct from true
     or v_volatile is distinct from 's'
     or v_lang is distinct from 'sql'
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: own_contact has pronargs %, result %, prosecdef %, provolatile %, language % and proconfig %; expected 0 arguments, TABLE(email text, email_preferences jsonb), prosecdef true, provolatile s (stable), language sql and search_path=public among proconfig',
      v_nargs, v_result, v_secdef, v_volatile, v_lang, v_config;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: authenticated may execute own_contact(); anon and
  -- service_role may not; and its ACL is set and grants PUBLIC (grantee 0)
  -- no EXECUTE.
  ---------------------------------------------------------------------------
  select has_function_privilege('authenticated', 'public.own_contact()', 'execute'),
         has_function_privilege('anon', 'public.own_contact()', 'execute'),
         has_function_privilege('service_role', 'public.own_contact()', 'execute')
    into v_can_authed, v_can_anon, v_can_service;

  select p.proacl is not null,
         exists (select 1
                   from aclexplode(p.proacl) x
                  where x.grantee = 0
                    and x.privilege_type = 'EXECUTE')
    into v_acl_set, v_public_exec
    from pg_proc p
   where p.oid = 'public.own_contact()'::regprocedure;

  if v_can_authed is distinct from true or v_can_anon is distinct from false
     or v_can_service is distinct from false
     or v_acl_set is distinct from true or v_public_exec is distinct from false then
    raise exception
      'GUARD FAIL: own_contact is executable by authenticated: %, anon: %, service_role: %; its ACL is set: % and grants PUBLIC EXECUTE: %; expected true, false, false, true and false',
      v_can_authed, v_can_anon, v_can_service, v_acl_set, v_public_exec;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: owner is answered exactly one row, their own email and
  -- email_preferences.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(c.email), max(c.email_preferences::text)::jsonb
    into v_count, v_email, v_prefs
    from public.own_contact() c;

  perform set_config('role', v_orig_role, true);

  if v_count <> 1 or v_email is distinct from v_owner_email
     or v_prefs is distinct from v_owner_prefs then
    raise exception
      'CONTACT FAIL: own_contact as % answers % row(s), reading % and %; expected exactly 1 row reading % and %',
      v_owner, v_count, v_email, v_prefs, v_owner_email, v_owner_prefs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: giver, who shares a family group with owner, is answered
  -- exactly one row, their own, not owner's.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(c.email), max(c.email_preferences::text)::jsonb
    into v_count, v_email, v_prefs
    from public.own_contact() c;

  perform set_config('role', v_orig_role, true);

  if v_count <> 1 or v_email is distinct from v_giver_email
     or v_prefs is distinct from v_giver_prefs then
    raise exception
      'CONTACT FAIL: own_contact as % answers % row(s), reading % and %; expected exactly 1 row reading their own % and %, not %''s',
      v_giver, v_count, v_email, v_prefs, v_giver_email, v_giver_prefs, v_owner;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: ghost, an id with no profile row (the connecting role's
  -- count shows there is none), is answered no row.
  ---------------------------------------------------------------------------
  select count(*) into v_count2
    from user_profiles
   where id = v_ghost;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_ghost || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from public.own_contact() c;

  perform set_config('role', v_orig_role, true);

  if v_count <> 0 or v_count2 <> 0 then
    raise exception
      'CONTACT FAIL: own_contact as %, who has % profile row(s), answers % row(s); expected no profile row and 0 rows',
      v_ghost, v_count2, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: visible_item_marks() takes one argument, p_item_ids
  -- uuid[], and returns a table of item_id uuid, purchased boolean and
  -- out_of_stock_marked_by text; it is SECURITY DEFINER, stable and written
  -- in SQL, with search_path pinned.
  ---------------------------------------------------------------------------
  select p.pronargs, pg_get_function_arguments(p.oid), pg_get_function_result(p.oid),
         p.prosecdef, p.provolatile::text, l.lanname::text, p.proconfig
    into v_nargs, v_args, v_result, v_secdef, v_volatile, v_lang, v_config
    from pg_proc p
    join pg_language l on l.oid = p.prolang
   where p.oid = 'public.visible_item_marks(uuid[])'::regprocedure;

  if v_nargs is distinct from 1
     or v_args is distinct from 'p_item_ids uuid[]'
     or v_result is distinct from 'TABLE(item_id uuid, purchased boolean, out_of_stock_marked_by text)'
     or v_secdef is distinct from true
     or v_volatile is distinct from 's'
     or v_lang is distinct from 'sql'
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: visible_item_marks has pronargs %, arguments %, result %, prosecdef %, provolatile %, language % and proconfig %; expected 1 argument, p_item_ids uuid[], TABLE(item_id uuid, purchased boolean, out_of_stock_marked_by text), prosecdef true, provolatile s (stable), language sql and search_path=public among proconfig',
      v_nargs, v_args, v_result, v_secdef, v_volatile, v_lang, v_config;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: its definition holds no block comment (the floor beneath
  -- the patterns below), and holds the three conditions of the policy
  -- "Users can view wishlist items based on privacy", each on lines of its
  -- own (so not line-commented): the caller is signed in; is not the item's
  -- owner; and can see it, by can_view_wishlist_item() with the item's
  -- owner first and the caller as the viewer.
  ---------------------------------------------------------------------------
  v_def := pg_get_functiondef('public.visible_item_marks(uuid[])'::regprocedure);

  v_signed_in := v_def ~
    '(?n)^\s*and \(select public\.requesting_user_id\(\)\) is not null$';
  v_not_owner := v_def ~
    '(?n)^\s*and wi\.user_id <> \(select public\.requesting_user_id\(\)\)$';
  v_can_view := v_def ~
    '(?n)^\s*and public\.can_view_wishlist_item\(\n\s*wi\.user_id, \(select public\.requesting_user_id\(\)\), wi\.privacy_settings\)$';

  if position(v_block_open in v_def) <> 0
     or v_signed_in is distinct from true
     or v_not_owner is distinct from true
     or v_can_view is distinct from true then
    raise exception
      'GUARD FAIL: visible_item_marks''s definition has a block comment at character % (expected 0); it holds the signed-in condition: %, the not-the-owner condition: %, and the can_view_wishlist_item(owner, caller, privacy_settings) condition: % (expected true for all three, each not line-commented)',
      position(v_block_open in v_def), v_signed_in, v_not_owner, v_can_view;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: authenticated may execute visible_item_marks(); anon and
  -- service_role may not; and its ACL is set and grants PUBLIC (grantee 0)
  -- no EXECUTE.
  ---------------------------------------------------------------------------
  select has_function_privilege('authenticated', 'public.visible_item_marks(uuid[])', 'execute'),
         has_function_privilege('anon', 'public.visible_item_marks(uuid[])', 'execute'),
         has_function_privilege('service_role', 'public.visible_item_marks(uuid[])', 'execute')
    into v_can_authed, v_can_anon, v_can_service;

  select p.proacl is not null,
         exists (select 1
                   from aclexplode(p.proacl) x
                  where x.grantee = 0
                    and x.privilege_type = 'EXECUTE')
    into v_acl_set, v_public_exec
    from pg_proc p
   where p.oid = 'public.visible_item_marks(uuid[])'::regprocedure;

  if v_can_authed is distinct from true or v_can_anon is distinct from false
     or v_can_service is distinct from false
     or v_acl_set is distinct from true or v_public_exec is distinct from false then
    raise exception
      'GUARD FAIL: visible_item_marks is executable by authenticated: %, anon: %, service_role: %; its ACL is set: % and grants PUBLIC EXECUTE: %; expected true, false, false, true and false',
      v_can_authed, v_can_anon, v_can_service, v_acl_set, v_public_exec;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: the fixture is what assertions 10-13 assume, so each item
  -- left out of an answer there is left out by the function. As the
  -- connecting role: A, D and E are bought with no marker, B is not bought
  -- and marked by giver, C is neither; A-D are owner's and E is giver's.
  -- Through row-level security: giver sees A, B and C and not D; owner sees
  -- E; stranger sees none of the five.
  ---------------------------------------------------------------------------
  select count(*) filter (where w.id in (v_a, v_d, v_e)
                            and w.purchased is true
                            and w.out_of_stock_marked_by is null),
         count(*) filter (where w.id = v_b
                            and w.purchased is false
                            and w.out_of_stock_marked_by = v_giver),
         count(*) filter (where w.id = v_c
                            and w.purchased is false
                            and w.out_of_stock_marked_by is null),
         count(*) filter (where w.id in (v_a, v_b, v_c, v_d) and w.user_id = v_owner),
         count(*) filter (where w.id = v_e and w.user_id = v_giver)
    into v_count, v_count2, v_count3, v_count4, v_count5
    from wishlist_items w
   where w.id = any (v_ids);

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) filter (where w.id in (v_a, v_b, v_c)),
         count(*) filter (where w.id = v_d)
    into v_seen, v_seen2
    from wishlist_items w
   where w.id = any (v_ids);

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);

  select count(*) into v_seen3
    from wishlist_items w
   where w.id = v_e;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_stranger || '","role":"authenticated"}', true);

  select count(*) into v_seen4
    from wishlist_items w
   where w.id = any (v_ids);

  perform set_config('role', v_orig_role, true);

  if v_count <> 3 or v_count2 <> 1 or v_count3 <> 1 or v_count4 <> 4 or v_count5 <> 1
     or v_seen <> 3 or v_seen2 <> 0 or v_seen3 <> 1 or v_seen4 <> 0 then
    raise exception
      'MARKS FAIL: of the five items, % of A, D and E are bought with no marker (expected 3), % of B is marked by % and not bought (expected 1), % of C carries no mark (expected 1), % of A-D are %''s (expected 4) and % of E is %''s (expected 1); through row-level security % sees % of A, B and C (expected 3) and % of D (expected 0), % sees % of E (expected 1) and % sees % of the five (expected 0); the answers below would prove nothing',
      v_count, v_count2, v_giver, v_count3, v_count4, v_owner, v_count5, v_giver,
      v_giver, v_seen, v_seen2, v_owner, v_seen3, v_stranger, v_seen4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: giver, asked about A, B, C, D and E together, is answered
  -- exactly two rows: A, bought with no marker, and B, not bought and marked
  -- out of stock by giver. Nothing about C (no mark), D (not seen by giver)
  -- or E (giver's own).
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*),
         count(*) filter (where m.item_id = v_a
                            and m.purchased is true
                            and m.out_of_stock_marked_by is null),
         count(*) filter (where m.item_id = v_b
                            and m.purchased is false
                            and m.out_of_stock_marked_by = v_giver),
         string_agg(m.item_id::text || '/' || coalesce(m.purchased::text, 'null')
                    || '/' || coalesce(m.out_of_stock_marked_by, 'null'),
                    ', ' order by m.item_id)
    into v_count, v_count2, v_count3, v_answer
    from public.visible_item_marks(v_ids) m;

  perform set_config('role', v_orig_role, true);

  if v_count <> 2 or v_count2 <> 1 or v_count3 <> 1 then
    raise exception
      'MARKS FAIL: visible_item_marks as %, asked about A, B, C, D and E, answers % row(s) (%); expected exactly 2: A (%) bought with no marker, and B (%) not bought, marked by %',
      v_giver, v_count, coalesce(v_answer, 'none'), v_a, v_b, v_giver;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: owner, asked about the same five, is answered exactly one
  -- row: E, bought with no marker. Nothing about A, B, C or D, their own.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*),
         count(*) filter (where m.item_id = v_e
                            and m.purchased is true
                            and m.out_of_stock_marked_by is null),
         string_agg(m.item_id::text || '/' || coalesce(m.purchased::text, 'null')
                    || '/' || coalesce(m.out_of_stock_marked_by, 'null'),
                    ', ' order by m.item_id)
    into v_count, v_count2, v_answer
    from public.visible_item_marks(v_ids) m;

  perform set_config('role', v_orig_role, true);

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'MARKS FAIL: visible_item_marks as %, asked about A, B, C, D and E, answers % row(s) (%); expected exactly 1: E (%) bought with no marker, and nothing about their own A, B, C or D',
      v_owner, v_count, coalesce(v_answer, 'none'), v_e;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12: stranger, who shares no group with owner or giver, asked
  -- about the same five, is answered no row.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_stranger || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*),
         string_agg(m.item_id::text, ', ' order by m.item_id)
    into v_count, v_answer
    from public.visible_item_marks(v_ids) m;

  perform set_config('role', v_orig_role, true);

  if v_count <> 0 then
    raise exception
      'MARKS FAIL: visible_item_marks as %, asked about A, B, C, D and E, answers % row(s) (%); expected 0',
      v_stranger, v_count, coalesce(v_answer, 'none');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 13: giver, asked about C alone (seen, with no mark), is
  -- answered no row; asked about an empty list, no row; asked about a null
  -- list, no row.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from public.visible_item_marks(array[v_c]) m;

  select count(*) into v_count2
    from public.visible_item_marks('{}'::uuid[]) m;

  select count(*) into v_count3
    from public.visible_item_marks(null::uuid[]) m;

  perform set_config('role', v_orig_role, true);

  if v_count <> 0 or v_count2 <> 0 or v_count3 <> 0 then
    raise exception
      'MARKS FAIL: visible_item_marks as % answers % row(s) for C alone, % for an empty list and % for a null list; expected 0 for each',
      v_giver, v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 13 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 13', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_26_own_contact_and_item_marks');
end $$;

select token as result from _harness_result;
