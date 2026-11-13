-- 20261112000000_profile_visibility.sql: profile_visibility, one row per
-- person holding the kinds of group they chose to see their profile fields,
-- with its three policies; start_profile_visibility(), the repair (D10) and
-- start (D11) the migration ran once for everyone with fields; and
-- set_profile_visibility(), which saves a person's choice and writes it onto
-- every one of their fields in one call. This file proves:
--
--   1. The table's shape (assertions 1-4). user_id is text, not null, the
--      only column of the only primary key, and the only column of the one
--      foreign key, to user_profiles, on delete cascade.
--      visible_to_group_types is a not-null group_type[].
--   2. Row-level security (assertions 5-14). RLS is on. Exactly one
--      permissive SELECT, INSERT and UPDATE policy, none for DELETE or ALL,
--      each for authenticated alone, and each, compared whole as Postgres
--      prints it, comparing requesting_user_id() with user_id and nothing
--      else. authenticated may select, insert and update, never delete;
--      anon may do none of the four. Then live: a
--      person with no row inserts their own and gets all four kinds by
--      default; a reads their own row; a sees nothing of b's row although
--      the two share a family group; a's update of b's row touches nothing;
--      a's update of their own row lands.
--   3. start_profile_visibility (assertions 15-16). Not SECURITY DEFINER,
--      search_path pinned, executable by none of anon, authenticated and
--      service_role.
--   4. The repair and the start, on this file's own people (assertions
--      17-23). hidden's five fields name no kind of group (an empty list, an
--      empty list with no restrictToGroup key, an empty object, a list
--      naming only an unknown kind, and settings that are an array rather
--      than an object): each becomes an object naming all four kinds, a key
--      other than the two it sets is kept, and hidden's row holds all four.
--      mixed's fields each name a
--      kind (one of them beside an unknown kind) or are tied to the group:
--      none is touched. mixed's row holds the setting two of its three
--      untied fields have (a list's order does not matter, and an unknown
--      kind is not counted). Its three tied fields do not vote: if they did,
--      the two naming work would tie the two naming family and friends, and
--      win on fewer kinds. tie's three fields each name a different setting,
--      one field apiece: the two naming one kind beat the one naming two,
--      and between work and custom the enum's order puts work first. none
--      has no fields and gets no row. a and b, not passed to the function,
--      keep their field and rows as they were.
--   5. set_profile_visibility (assertions 24-35). saver has three fields
--      with three different settings, one tied to the group, and no stored
--      row. A call with {friends} stores it and leaves all three naming
--      exactly ["friends"] with no tie; a call with {work,family,NULL,work}
--      stores {family,work} (once each, in the enum's order, the null
--      dropped) and writes that; a call with {} (only you) stores {} and
--      leaves the fields naming no kind. a's and b's rows, a's field and
--      hidden's row are untouched. anon cannot execute it and authenticated
--      can; it is SECURITY INVOKER with search_path pinned; it stores the
--      choice before it writes the fields (the migration's lock order); and
--      it refuses a signed-out call with 28000 and a null argument with 22023
--      before either write.
--
-- REFUSALS THAT RAISE ARE NOT ATTEMPTED LIVE. A delete by authenticated
-- (which holds no DELETE privilege) and an insert of another person's row
-- (refused by the INSERT policy's with check) both raise, and one uncaught
-- raise ends the whole batch this file is sent as; the runner bans handlers
-- file-wide. Assertion 8 holds the first at the privilege layer and
-- assertion 7 the second in the policy's own text. The refusals that do not
-- raise -- a's read and update of b's row, which the policies filter to no
-- rows -- are attempted live (12, 13). set_profile_visibility's refusals of
-- a signed-out call (28000) and a null argument (22023) raise too: they are
-- held by line-anchored checks of the deployed definition (34, 35), with the
-- no-block-comment floor beneath them (33) and a check that each refusal
-- comes before the first write.
--
-- WHO RUNS THE FUNCTION. No API role may execute start_profile_visibility()
-- (assertion 16), so it is called here as the connecting role, which runs it
-- as the migration's role does: as the function's owner. It is passed only
-- people this file made.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. Each impersonated read, write or call
-- sets request.jwt.claims and role around it (set_profile_visibility is
-- called as the signed-in saver, as the website calls it), and `role` goes
-- back to the captured current_user before every catalog read and every
-- read that verifies a write. Each impersonated insert or update reads its
-- row_count.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role       text;
  v_checks          int := 0;
  v_a               text := 'user_pvis_a';
  v_b               text := 'user_pvis_b';
  v_fresh           text := 'user_pvis_fresh';
  v_hidden          text := 'user_pvis_hidden';
  v_mixed           text := 'user_pvis_mixed';
  v_tie             text := 'user_pvis_tie';
  v_none            text := 'user_pvis_none';
  v_saver           text := 'user_pvis_saver';
  v_group           uuid;
  v_ring_settings   jsonb;
  v_tied_work_settings jsonb;
  v_settings        jsonb;
  v_count           int;
  v_count2          int;
  v_count3          int;
  v_count4          int;
  -- A block-comment opener, built so this file holds none itself.
  v_block_open      text := '/' || '*';
  v_set_def         text;
  v_pos_refusal     int;
  v_pos_store       int;
  v_pos_fields      int;
  v_type            text;
  v_typid           regtype;
  v_notnull         boolean;
  v_pk_columns      text[];
  v_rls             boolean;
  v_pol_select      int;
  v_pol_insert      int;
  v_pol_update      int;
  v_pol_other       int;
  v_pol_bad_roles   int;
  v_select_qual     text;
  v_insert_check    text;
  v_update_qual     text;
  v_update_check    text;
  v_priv_select     boolean;
  v_priv_insert     boolean;
  v_priv_update     boolean;
  v_priv_delete     boolean;
  v_kinds           public.group_type[];
  v_kinds2          public.group_type[];
  v_secdef          boolean;
  v_config          text[];
  v_can_anon        boolean;
  v_can_authed      boolean;
  v_can_service     boolean;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_a,      'pvisa',      'Pvis A'),
           (v_b,      'pvisb',      'Pvis B'),
           (v_fresh,  'pvisfresh',  'Pvis Fresh'),
           (v_hidden, 'pvishidden', 'Pvis Hidden'),
           (v_mixed,  'pvismixed',  'Pvis Mixed'),
           (v_tie,    'pvistie',    'Pvis Tie'),
           (v_none,   'pvisnone',   'Pvis None'),
           (v_saver,  'pvissaver',  'Pvis Saver');

  -- add_group_creator_as_owner() adds a. b joins, so a and b share a
  -- "family" group: assertions 12 and 13 show that sharing it gives a
  -- nothing of b's row.
  insert into groups (name, type, invite_code, created_by)
    values ('Pvis Family', 'family', 'PVISFAM1', v_a)
    returning id into v_group;

  insert into group_members (group_id, user_id, role)
    values (v_group, v_b, 'member')
    on conflict do nothing;

  -- mixed's ring, pants and dress sizes are tied to the group, so none of
  -- them is repaired or votes. The pants and dress sizes name work: if tied
  -- fields voted, work would win assertion 21.
  v_ring_settings := jsonb_build_object(
    'visibleToGroupTypes', '[]'::jsonb,
    'restrictToGroup', v_group);

  v_tied_work_settings := jsonb_build_object(
    'visibleToGroupTypes', '["work"]'::jsonb,
    'restrictToGroup', v_group);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_a,      'sizes',       'shoe_size',  '9',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb),
           (v_hidden, 'sizes',       'shoe_size',  '10',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb),
           (v_hidden, 'sizes',       'hat_size',   '7',
            '{"visibleToGroupTypes": []}'::jsonb),
           (v_hidden, 'sizes',       'ring_size',  '6',
            '{}'::jsonb),
           (v_hidden, 'preferences', 'hobbies',    'Climbing',
            '{"visibleToGroupTypes": ["nonsense"], "restrictToGroup": null, "overrides": {"x": "y"}}'::jsonb),
           (v_hidden, 'sizes',       'pants_size', '30',
            '[]'::jsonb),
           (v_mixed,  'sizes',       'shoe_size',  '8',
            '{"visibleToGroupTypes": ["family", "friends"], "restrictToGroup": null}'::jsonb),
           (v_mixed,  'sizes',       'shirt_size', 'M',
            '{"visibleToGroupTypes": ["friends", "family"], "restrictToGroup": null}'::jsonb),
           (v_mixed,  'sizes',       'hat_size',   '7',
            '{"visibleToGroupTypes": ["family", "nonsense"], "restrictToGroup": null}'::jsonb),
           (v_mixed,  'sizes',       'ring_size',  '5',
            v_ring_settings),
           (v_mixed,  'sizes',       'pants_size', '32',
            v_tied_work_settings),
           (v_mixed,  'sizes',       'dress_size', '8',
            v_tied_work_settings),
           (v_tie,    'sizes',       'shoe_size',  '11',
            '{"visibleToGroupTypes": ["work"], "restrictToGroup": null}'::jsonb),
           (v_tie,    'sizes',       'shirt_size', 'L',
            '{"visibleToGroupTypes": ["family", "friends"], "restrictToGroup": null}'::jsonb),
           (v_tie,    'sizes',       'ring_size',  '7',
            '{"visibleToGroupTypes": ["custom"], "restrictToGroup": null}'::jsonb),
           -- saver's three fields, three different settings, the ring size
           -- tied to the group (assertions 24-35).
           (v_saver,  'sizes',       'shoe_size',  '8',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'::jsonb),
           (v_saver,  'sizes',       'shirt_size', 'S',
            '{"visibleToGroupTypes": ["work", "custom"], "restrictToGroup": null, "overrides": {"x": "y"}}'::jsonb),
           (v_saver,  'sizes',       'ring_size',  '5',
            v_ring_settings);

  -- a's and b's stored rows go in after the fields, and nobody has a stored
  -- row when their fields go in. Each field then holds exactly what the
  -- fixture wrote, including once a new field takes its owner's stored row
  -- on insert (20261112000001_profile_fields_take_the_stored_choice.sql,
  -- applied after this file's migration). a's field must still name no kind:
  -- assertion 23 shows that a, not passed to the function, keeps it as
  -- written.
  insert into profile_visibility (user_id, visible_to_group_types)
    values (v_a, '{family}'::public.group_type[]),
           (v_b, '{friends}'::public.group_type[]);

  ---------------------------------------------------------------------------
  -- Assertions 1-2: the columns.
  ---------------------------------------------------------------------------
  select format_type(a.atttypid, a.atttypmod), a.attnotnull
    into v_type, v_notnull
    from pg_attribute a
   where a.attrelid = 'public.profile_visibility'::regclass
     and a.attname = 'user_id'
     and not a.attisdropped;

  if v_type is distinct from 'text' or v_notnull is distinct from true then
    raise exception
      'SCHEMA FAIL: profile_visibility.user_id has type % and attnotnull %, expected type text and not null',
      v_type, v_notnull;
  end if;
  v_checks := v_checks + 1;

  select a.atttypid::regtype, a.attnotnull
    into v_typid, v_notnull
    from pg_attribute a
   where a.attrelid = 'public.profile_visibility'::regclass
     and a.attname = 'visible_to_group_types'
     and not a.attisdropped;

  if v_typid is distinct from 'public.group_type[]'::regtype
     or v_notnull is distinct from true then
    raise exception
      'SCHEMA FAIL: profile_visibility.visible_to_group_types has type % and attnotnull %, expected type group_type[] and not null',
      v_typid, v_notnull;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: one primary key, on user_id alone. A key on more columns
  -- would let a person hold two rows, and which one counts would be
  -- anyone's guess.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from pg_constraint
   where conrelid = 'public.profile_visibility'::regclass
     and contype = 'p';

  select array_agg(a.attname order by k.ord) into v_pk_columns
    from pg_constraint con
    cross join lateral unnest(con.conkey) with ordinality as k(attnum, ord)
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.attnum
   where con.conrelid = 'public.profile_visibility'::regclass
     and con.contype = 'p';

  if v_count <> 1 or v_pk_columns is distinct from array['user_id'] then
    raise exception
      'SCHEMA FAIL: profile_visibility has % primary key(s) covering column(s) %, expected exactly 1 covering exactly {user_id}',
      v_count, v_pk_columns;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: one foreign key, on user_id alone, to user_profiles, on
  -- delete cascade (confdeltype 'c'): a row goes with its person.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.conkey = array[a.attnum]
                            and c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'c')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attname = 'user_id' and not a.attisdropped
   where c.conrelid = 'public.profile_visibility'::regclass
     and c.contype = 'f';

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: profile_visibility has % foreign key(s), % of them on user_id alone to user_profiles on delete cascade; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: row-level security is on.
  ---------------------------------------------------------------------------
  select relrowsecurity into v_rls
    from pg_class
   where oid = 'public.profile_visibility'::regclass;

  if v_rls is distinct from true then
    raise exception
      'RLS FAIL: profile_visibility has relrowsecurity %, expected true',
      v_rls;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: population control. Exactly one permissive policy for each
  -- of SELECT, INSERT and UPDATE, none for DELETE or ALL, and every policy
  -- for authenticated alone. A second permissive policy would be ORed in
  -- beside the right one, unseen by assertion 7, which reads one policy per
  -- command.
  ---------------------------------------------------------------------------
  select count(*) filter (where cmd = 'SELECT' and permissive = 'PERMISSIVE'),
         count(*) filter (where cmd = 'INSERT' and permissive = 'PERMISSIVE'),
         count(*) filter (where cmd = 'UPDATE' and permissive = 'PERMISSIVE'),
         count(*) filter (where cmd in ('DELETE', 'ALL')),
         count(*) filter (where roles is distinct from '{authenticated}'::name[])
    into v_pol_select, v_pol_insert, v_pol_update, v_pol_other, v_pol_bad_roles
    from pg_policies
   where schemaname = 'public'
     and tablename = 'profile_visibility';

  if v_pol_select <> 1 or v_pol_insert <> 1 or v_pol_update <> 1
     or v_pol_other <> 0 or v_pol_bad_roles <> 0 then
    raise exception
      'RLS FAIL: profile_visibility has % permissive SELECT, % permissive INSERT and % permissive UPDATE polic(y/ies), % DELETE or ALL polic(y/ies), and % polic(y/ies) for roles other than exactly {authenticated}; expected 1, 1, 1, 0 and 0',
      v_pol_select, v_pol_insert, v_pol_update, v_pol_other, v_pol_bad_roles;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: each of the four expressions is exactly the text Postgres
  -- prints for `(select public.requesting_user_id()) = user_id`, compared
  -- whole as 14_tag_visibility.sql compares its policy, so a changed
  -- operator or an added condition fails it. The INSERT policy's with check
  -- is what refuses a row written for someone else (see the header), and the
  -- UPDATE policy's check what refuses moving a row to another person;
  -- neither is attempted live, so this is what holds them.
  ---------------------------------------------------------------------------
  select qual into v_select_qual
    from pg_policies
   where schemaname = 'public' and tablename = 'profile_visibility'
     and cmd = 'SELECT' and permissive = 'PERMISSIVE';

  select with_check into v_insert_check
    from pg_policies
   where schemaname = 'public' and tablename = 'profile_visibility'
     and cmd = 'INSERT' and permissive = 'PERMISSIVE';

  select qual, with_check into v_update_qual, v_update_check
    from pg_policies
   where schemaname = 'public' and tablename = 'profile_visibility'
     and cmd = 'UPDATE' and permissive = 'PERMISSIVE';

  select count(*) into v_count
    from unnest(array[v_select_qual, v_insert_check, v_update_qual, v_update_check]) e(expr)
   where e.expr = '(( SELECT requesting_user_id() AS requesting_user_id) = user_id)';

  if v_count <> 4 then
    raise exception
      'RLS FAIL: % of the four policy expressions read exactly (( SELECT requesting_user_id() AS requesting_user_id) = user_id), expected 4. SELECT using: %; INSERT with check: %; UPDATE using: %; UPDATE with check: %',
      v_count, v_select_qual, v_insert_check, v_update_qual, v_update_check;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: authenticated holds SELECT, INSERT and UPDATE, and not
  -- DELETE. Supabase's default privileges give authenticated every DML verb
  -- on a new public table; the migration revokes DELETE, so a row goes only
  -- with its person.
  ---------------------------------------------------------------------------
  select has_table_privilege('authenticated', 'public.profile_visibility', 'SELECT'),
         has_table_privilege('authenticated', 'public.profile_visibility', 'INSERT'),
         has_table_privilege('authenticated', 'public.profile_visibility', 'UPDATE'),
         has_table_privilege('authenticated', 'public.profile_visibility', 'DELETE')
    into v_priv_select, v_priv_insert, v_priv_update, v_priv_delete;

  if v_priv_select is distinct from true or v_priv_insert is distinct from true
     or v_priv_update is distinct from true or v_priv_delete is distinct from false then
    raise exception
      'RLS FAIL: authenticated holds SELECT %, INSERT %, UPDATE %, DELETE % on profile_visibility; expected true, true, true, false',
      v_priv_select, v_priv_insert, v_priv_update, v_priv_delete;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: anon holds none of the four. 06_anon_has_no_reach.sql
  -- checks every table; this repeats it for this one, so this file states
  -- the table's whole privilege picture.
  ---------------------------------------------------------------------------
  select has_table_privilege('anon', 'public.profile_visibility', 'SELECT'),
         has_table_privilege('anon', 'public.profile_visibility', 'INSERT'),
         has_table_privilege('anon', 'public.profile_visibility', 'UPDATE'),
         has_table_privilege('anon', 'public.profile_visibility', 'DELETE')
    into v_priv_select, v_priv_insert, v_priv_update, v_priv_delete;

  if v_priv_select is distinct from false or v_priv_insert is distinct from false
     or v_priv_update is distinct from false or v_priv_delete is distinct from false then
    raise exception
      'RLS FAIL: anon holds SELECT %, INSERT %, UPDATE %, DELETE % on profile_visibility; expected false for all four',
      v_priv_select, v_priv_insert, v_priv_update, v_priv_delete;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: fresh, who has no row, inserts their own, naming no kinds,
  -- and it holds all four (the column's default). Read back as the
  -- connecting role.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_fresh || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into profile_visibility (user_id) values (v_fresh);
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_fresh;

  if v_count <> 1
     or v_kinds is distinct from '{family,friends,work,custom}'::public.group_type[] then
    raise exception
      'RLS FAIL: % inserting their own row wrote % row(s), and the row reads %; expected 1 row reading {family,friends,work,custom}',
      v_fresh, v_count, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: a reads their own row.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from profile_visibility
   where user_id = v_a;

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_a;

  if v_count <> 1 or v_kinds is distinct from '{family}'::public.group_type[] then
    raise exception
      'RLS FAIL: % sees % row(s) of their own, reading %; expected 1 row reading {family}',
      v_a, v_count, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12: a sees nothing of b's row, although a and b share a
  -- family group. The connecting role's count shows the row is there, so
  -- a's 0 measures the policy, not an empty table.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from profile_visibility
   where user_id = v_b;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count2
    from profile_visibility
   where user_id = v_b;

  if v_count <> 0 or v_count2 <> 1 then
    raise exception
      'RLS FAIL: % sees % row(s) of %''s, with whom they share a family group, and % row(s) of it exist; expected 0 seen of 1',
      v_a, v_count, v_b, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 13: a's update of b's row touches nothing (the policies
  -- filter it out, so no raise), and b's row is still {friends}.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update profile_visibility
     set visible_to_group_types = '{}'::public.group_type[]
   where user_id = v_b;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_b;

  if v_count <> 0 or v_kinds is distinct from '{friends}'::public.group_type[] then
    raise exception
      'RLS FAIL: % updating %''s row changed % row(s), and that row now reads %; expected 0 changed and {friends}',
      v_a, v_b, v_count, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 14: a's update of their own row lands.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update profile_visibility
     set visible_to_group_types = '{family,work}'::public.group_type[]
   where user_id = v_a;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_a;

  if v_count <> 1 or v_kinds is distinct from '{family,work}'::public.group_type[] then
    raise exception
      'RLS FAIL: % updating their own row changed % row(s), and it now reads %; expected 1 changed and {family,work}',
      v_a, v_count, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertions 15-16: start_profile_visibility runs as its caller (it is not
  -- SECURITY DEFINER), with search_path pinned, and no API role may execute
  -- it.
  ---------------------------------------------------------------------------
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p
   where p.oid = 'public.start_profile_visibility(text[])'::regprocedure;

  if v_secdef is distinct from false
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: start_profile_visibility has prosecdef % and proconfig %, expected prosecdef false and search_path=public among proconfig',
      v_secdef, v_config;
  end if;
  v_checks := v_checks + 1;

  select has_function_privilege('anon', 'public.start_profile_visibility(text[])', 'execute'),
         has_function_privilege('authenticated', 'public.start_profile_visibility(text[])', 'execute'),
         has_function_privilege('service_role', 'public.start_profile_visibility(text[])', 'execute')
    into v_can_anon, v_can_authed, v_can_service;

  if v_can_anon is distinct from false or v_can_authed is distinct from false
     or v_can_service is distinct from false then
    raise exception
      'GUARD FAIL: start_profile_visibility is executable by anon: %, authenticated: %, service_role: %; expected false for all three',
      v_can_anon, v_can_authed, v_can_service;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The repair and the start, run as the connecting role (the function's
  -- owner, as when the migration ran it) on hidden, mixed, tie and none
  -- only.
  ---------------------------------------------------------------------------
  perform public.start_profile_visibility(array[v_hidden, v_mixed, v_tie, v_none]);

  ---------------------------------------------------------------------------
  -- Assertion 17: each of hidden's five fields is now an object naming all
  -- four kinds, in the order the repair writes, and tied to no group. The
  -- pants size's settings were an array, not an object; the repair starts
  -- it from an empty object, or it would become an array holding one.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from profile_info
   where user_id = v_hidden
     and privacy_settings->'visibleToGroupTypes' = '["family", "friends", "work", "custom"]'::jsonb
     and privacy_settings->'restrictToGroup' = 'null'::jsonb;

  if v_count <> 5 then
    raise exception
      'START FAIL: % of %''s five fields name all four kinds and no group after the repair, expected 5',
      v_count, v_hidden;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 18: the repair keeps a field's other keys.
  ---------------------------------------------------------------------------
  select privacy_settings->'overrides' into v_settings
    from profile_info
   where user_id = v_hidden
     and category = 'preferences'
     and field_name = 'hobbies';

  if v_settings is distinct from '{"x": "y"}'::jsonb then
    raise exception
      'START FAIL: %''s hobbies field has overrides % after the repair, expected {"x": "y"} as the fixture wrote it',
      v_hidden, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 19: hidden's row holds all four kinds, the setting of every
  -- one of their fields after the repair.
  ---------------------------------------------------------------------------
  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_hidden;

  if v_kinds is distinct from '{family,friends,work,custom}'::public.group_type[] then
    raise exception
      'START FAIL: %''s row reads %, expected {family,friends,work,custom}',
      v_hidden, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 20: none of mixed's six fields is touched -- three name a
  -- kind (the hat size beside an unknown kind), and three are tied to the
  -- group. Each still holds exactly what the fixture wrote.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from profile_info
   where user_id = v_mixed
     and category = 'sizes'
     and ((field_name = 'shoe_size'
           and privacy_settings = '{"visibleToGroupTypes": ["family", "friends"], "restrictToGroup": null}'::jsonb)
       or (field_name = 'shirt_size'
           and privacy_settings = '{"visibleToGroupTypes": ["friends", "family"], "restrictToGroup": null}'::jsonb)
       or (field_name = 'hat_size'
           and privacy_settings = '{"visibleToGroupTypes": ["family", "nonsense"], "restrictToGroup": null}'::jsonb)
       or (field_name = 'ring_size'
           and privacy_settings = v_ring_settings)
       or (field_name in ('pants_size', 'dress_size')
           and privacy_settings = v_tied_work_settings));

  if v_count <> 6 then
    raise exception
      'START FAIL: % of %''s six fields still hold what the fixture wrote, expected 6 -- the repair touched a field that names a kind or is tied to a group',
      v_count, v_mixed;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 21: mixed's row holds {family,friends}. ["friends","family"]
  -- counts with ["family","friends"], so that setting has two fields to the
  -- one of {family} (the hat size; its unknown kind is not counted). The
  -- three fields tied to the group do not vote: if they did, the pants and
  -- dress sizes would give {work} two fields too, and {work} would win on
  -- fewer kinds.
  ---------------------------------------------------------------------------
  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_mixed;

  if v_kinds is distinct from '{family,friends}'::public.group_type[] then
    raise exception
      'START FAIL: %''s row reads %, expected {family,friends}',
      v_mixed, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 22: a three-way tie of one field each: {work} and {custom}
  -- name one kind and beat {family,friends}; between those two the enum's
  -- order puts work first.
  ---------------------------------------------------------------------------
  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_tie;

  if v_kinds is distinct from '{work}'::public.group_type[] then
    raise exception
      'START FAIL: %''s row reads % after a three-way tie of one field each between {work}, {custom} and {family,friends}, expected {work} (fewer kinds, then the enum''s order)',
      v_tie, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 23: none, with no fields, gets no row; and a and b, not
  -- passed, are untouched: a's field still names no kind, a's row still
  -- holds what assertion 14 wrote, and b's what the fixture wrote.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from profile_visibility
   where user_id = v_none;

  select count(*) into v_count2
    from profile_info
   where user_id = v_a
     and category = 'sizes'
     and field_name = 'shoe_size'
     and privacy_settings = '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb;

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_a;

  select visible_to_group_types into v_kinds2
    from profile_visibility
   where user_id = v_b;

  if v_count <> 0 or v_count2 <> 1
     or v_kinds is distinct from '{family,work}'::public.group_type[]
     or v_kinds2 is distinct from '{friends}'::public.group_type[] then
    raise exception
      'START FAIL: % has % row(s) (expected 0); %''s field is unchanged in % row(s) (expected 1); %''s row reads % (expected {family,work}) and %''s reads % (expected {friends})',
      v_none, v_count, v_a, v_count2, v_a, v_kinds, v_b, v_kinds2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 24: saver, with three fields of three different settings (one
  -- tied) and no stored row, saves {friends}. The choice is stored.
  ---------------------------------------------------------------------------
  select count(*), count(distinct privacy_settings),
         count(*) filter (where privacy_settings = v_ring_settings)
    into v_count, v_count2, v_count3
    from profile_info
   where user_id = v_saver;

  select count(*) into v_count4
    from profile_visibility
   where user_id = v_saver;

  if v_count <> 3 or v_count2 <> 3 or v_count3 <> 1 or v_count4 <> 0 then
    raise exception
      'SAVE FAIL: before the first save % has % field(s) with % different setting(s), % tied, and % stored row(s); expected 3, 3, 1 and 0 -- the save below would prove nothing',
      v_saver, v_count, v_count2, v_count3, v_count4;
  end if;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_saver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.set_profile_visibility('{friends}'::public.group_type[]);

  perform set_config('role', v_orig_role, true);

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_saver;

  if v_kinds is distinct from '{friends}'::public.group_type[] then
    raise exception
      'SAVE FAIL: after saving {friends}, %''s stored row reads %, expected {friends}',
      v_saver, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 25: every one of saver's three fields, the tied one included,
  -- now names exactly ["friends"] with no tie, and nothing else (the shirt
  -- size's overrides are gone).
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where privacy_settings = '{"visibleToGroupTypes": ["friends"], "restrictToGroup": null}'::jsonb)
    into v_count, v_count2
    from profile_info
   where user_id = v_saver;

  if v_count <> 3 or v_count2 <> 3 then
    raise exception
      'SAVE FAIL: after saving {friends}, % of %''s % field(s) read exactly {"visibleToGroupTypes": ["friends"], "restrictToGroup": null}; expected 3 of 3',
      v_count2, v_saver, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 26: a save naming a kind twice, out of order and with a null
  -- stores each kind once, in the enum's order, the null dropped. saver's
  -- row exists now, so this is the update path.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  perform public.set_profile_visibility('{work,family,NULL,work}'::public.group_type[]);

  perform set_config('role', v_orig_role, true);

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_saver;

  if v_kinds is distinct from '{family,work}'::public.group_type[] then
    raise exception
      'SAVE FAIL: after saving {work,family,NULL,work}, %''s stored row reads %, expected {family,work}',
      v_saver, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 27: and every field names exactly ["family", "work"].
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where privacy_settings = '{"visibleToGroupTypes": ["family", "work"], "restrictToGroup": null}'::jsonb)
    into v_count, v_count2
    from profile_info
   where user_id = v_saver;

  if v_count <> 3 or v_count2 <> 3 then
    raise exception
      'SAVE FAIL: after saving {work,family,NULL,work}, % of %''s % field(s) read exactly {"visibleToGroupTypes": ["family", "work"], "restrictToGroup": null}; expected 3 of 3',
      v_count2, v_saver, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 28: an empty choice (only you) is stored as empty, not as no
  -- row and not as null.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  perform public.set_profile_visibility('{}'::public.group_type[]);

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from profile_visibility
   where user_id = v_saver;

  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_saver;

  if v_count <> 1 or v_kinds is distinct from '{}'::public.group_type[] then
    raise exception
      'SAVE FAIL: after saving {}, % has % stored row(s) reading %; expected 1 reading {}',
      v_saver, v_count, v_kinds;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 29: and every field names no kind, with no tie.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where privacy_settings = '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb)
    into v_count, v_count2
    from profile_info
   where user_id = v_saver;

  if v_count <> 3 or v_count2 <> 3 then
    raise exception
      'SAVE FAIL: after saving {}, % of %''s % field(s) read exactly {"visibleToGroupTypes": [], "restrictToGroup": null}; expected 3 of 3',
      v_count2, v_saver, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 30: saver's saves touched nobody else. a's and b's rows, a's
  -- field and hidden's row are as assertions 23 and 19 left them.
  ---------------------------------------------------------------------------
  select visible_to_group_types into v_kinds
    from profile_visibility
   where user_id = v_a;

  select visible_to_group_types into v_kinds2
    from profile_visibility
   where user_id = v_b;

  select count(*) into v_count
    from profile_info
   where user_id = v_a
     and category = 'sizes'
     and field_name = 'shoe_size'
     and privacy_settings = '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb;

  select count(*) into v_count2
    from profile_visibility
   where user_id = v_hidden
     and visible_to_group_types = '{family,friends,work,custom}'::public.group_type[];

  if v_kinds is distinct from '{family,work}'::public.group_type[]
     or v_kinds2 is distinct from '{friends}'::public.group_type[]
     or v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SAVE FAIL: after %''s saves, %''s row reads % (expected {family,work}), %''s reads % (expected {friends}), %''s field is unchanged in % row(s) (expected 1), and %''s row is unchanged in % row(s) (expected 1)',
      v_saver, v_a, v_kinds, v_b, v_kinds2, v_a, v_count, v_hidden, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 31: anon cannot execute set_profile_visibility; authenticated
  -- can.
  ---------------------------------------------------------------------------
  select has_function_privilege('anon', 'public.set_profile_visibility(public.group_type[])', 'execute'),
         has_function_privilege('authenticated', 'public.set_profile_visibility(public.group_type[])', 'execute')
    into v_can_anon, v_can_authed;

  if v_can_anon is distinct from false or v_can_authed is distinct from true then
    raise exception
      'GUARD FAIL: set_profile_visibility is executable by anon: %, authenticated: %; expected false and true',
      v_can_anon, v_can_authed;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 32: it runs as its caller (row-level security confines both
  -- writes to the caller's own rows), with search_path pinned.
  ---------------------------------------------------------------------------
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p
   where p.oid = 'public.set_profile_visibility(public.group_type[])'::regprocedure;

  if v_secdef is distinct from false
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: set_profile_visibility has prosecdef % and proconfig %, expected prosecdef false (security invoker) and search_path=public among proconfig',
      v_secdef, v_config;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 33: its definition has no block comment (the floor beneath
  -- assertions 34 and 35), and it stores the choice before it writes the
  -- fields: the migration's lock order, a person's profile_visibility row
  -- before their profile_info rows.
  ---------------------------------------------------------------------------
  v_set_def := pg_get_functiondef('public.set_profile_visibility(public.group_type[])'::regprocedure);
  v_pos_store := position('insert into profile_visibility' in v_set_def);
  v_pos_fields := position('update profile_info' in v_set_def);

  if position(v_block_open in v_set_def) <> 0
     or v_pos_store = 0 or v_pos_fields = 0 or v_pos_store > v_pos_fields then
    raise exception
      'GUARD FAIL: set_profile_visibility''s definition has a block comment at character % (expected 0), or stores the choice at character % and writes the fields at character % (expected both present, the store first)',
      position(v_block_open in v_set_def), v_pos_store, v_pos_fields;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 34: a signed-out call raises 28000, before either write. The
  -- caller is the requesting user, and the refusal comes before the first
  -- write.
  ---------------------------------------------------------------------------
  v_pos_refusal := position('raise exception ''not authenticated'' using errcode = ''28000'';' in v_set_def);

  if not v_set_def ~ '(?n)^\s*v_caller text := \(select public\.requesting_user_id\(\)\);$'
     or not v_set_def ~ '(?n)^\s*if v_caller is null then$'
     or not v_set_def ~ '(?n)^\s*raise exception ''not authenticated'' using errcode = ''28000'';$'
     or v_pos_refusal = 0 or v_pos_refusal > v_pos_store then
    raise exception
      'GUARD FAIL: set_profile_visibility no longer takes the caller from requesting_user_id() and refuses a signed-out call with 28000 before its first write, not line-commented (refusal at character %, first write at %)',
      v_pos_refusal, v_pos_store;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 35: a null argument raises 22023, before either write, so it
  -- changes nothing.
  ---------------------------------------------------------------------------
  v_pos_refusal := position('raise exception ''choose which kinds of group can see your details'' using errcode = ''22023'';' in v_set_def);

  if not v_set_def ~ '(?n)^\s*if p_kinds is null then$'
     or not v_set_def ~ '(?n)^\s*raise exception ''choose which kinds of group can see your details'' using errcode = ''22023'';$'
     or v_pos_refusal = 0 or v_pos_refusal > v_pos_store then
    raise exception
      'GUARD FAIL: set_profile_visibility no longer refuses a null argument with 22023 before its first write, not line-commented (refusal at character %, first write at %)',
      v_pos_refusal, v_pos_store;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 35 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 35', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_23_profile_visibility');
end $$;

select token as result from _harness_result;
