-- 20261120000000_group_gift_recipients.sql: group_gift_recipients, the table
-- of who each group gift is for (a gift and a person, each name going with
-- its gift or its person by cascade; row-level security on, no policy, no
-- privilege for anon or authenticated, and no truncate for service_role);
-- three triggers that keep the people a gift is for out of it (no member row
-- for a person named on the gift, no name for someone in the gift or for its
-- maker, no name deleted while its gift and its person both exist), and
-- reject_parent_reassignment() pinning each name; is_group_gift_member(),
-- which answers false for a person named on the gift; and the policy
-- group_gift_members_select, through which a gift's maker and its members
-- read its member rows. This file proves:
--
--   1. The table (assertions 1-2). Row-level security is on and it has no
--      policy; neither authenticated nor anon holds SELECT, INSERT, UPDATE or
--      DELETE on it, and service_role holds SELECT, INSERT and DELETE but not
--      TRUNCATE, which would not run the row trigger that guards removal. Its
--      primary key is (group_gift_id, user_id), and it has exactly two
--      foreign keys, group_gift_id to group_gifts and user_id to
--      user_profiles, each on delete cascade.
--   2. The triggers (assertions 3-5). group_gift_members has exactly one
--      enabled trigger running reject_group_gift_recipient_as_member, after
--      insert and update, for each row, so the row's own policy and the pin
--      on its gift and person decide first. group_gift_recipients has exactly
--      one enabled trigger running each of
--      reject_group_gift_member_as_recipient (before insert),
--      reject_parent_reassignment on group_gift_id and user_id (before
--      update) and reject_group_gift_recipient_removal (before delete), each
--      for each row. The three trigger functions are SECURITY DEFINER with
--      search_path pinned, and no API role (authenticated, anon,
--      service_role) may execute them. Each deployed definition holds no
--      block comment, and holds its refusal on a line of its own (so not
--      line-commented) directly under the condition that guards it, each of
--      that condition's lines whole and in order; the two that lock the
--      gift's row lock it for no key update on a line of its own, before the
--      refusal.
--   3. The membership test and the policy (assertions 6-7).
--      is_group_gift_member() is SECURITY DEFINER and stable, with
--      search_path pinned; its definition holds no block comment, keeps its
--      pin to requesting_user_id() and is_service_context(), and holds the
--      clause that answers false for a person named in group_gift_recipients,
--      each on lines of their own. group_gift_members_select, to
--      authenticated, is the only SELECT or ALL policy on group_gift_members;
--      it goes through the gift's maker (created_by) and
--      is_group_gift_member(), and compares no row's own user_id with the
--      caller, written either way round.
--   4. What each person is answered (assertions 8-10). Ggr Surprise is made
--      by maker, has member rows for maker and member, and names for1 and
--      for2. Asked by each person about themselves, is_group_gift_member() is
--      true there for maker and member and false for for1 and out. Asked by
--      for1 about Ggr Plain, which for1 is in, it is true. for1 reads nothing
--      of Ggr Surprise: not its group_gifts row, its member rows or its
--      message. member reads its two member rows and its message.
--   5. The cascades (assertions 11-12). Deleting Ggr Going deletes its name
--      for for1. Deleting for2's profile deletes for2's name on Ggr Surprise,
--      and Ggr Surprise keeps its row, its name for for1 and its member rows.
--
-- NO REFUSED WRITE IS ATTEMPTED. A member row for a named person, a name for
-- someone in the gift or for its maker, and the delete of a name whose gift
-- and person both exist each raise check_violation, and one uncaught raise
-- ends the whole batch this file is sent as; the runner bans handlers
-- file-wide. The three refusals are held by the catalog checks of assertions
-- 3-5: each trigger is there, enabled, and fires on the write it refuses
-- (rule 2 after the row's own policy and pin, its raise undoing the
-- statement; rules 3 and 5 before the write), and each function's refusal
-- and the condition that guards it are on lines of their own, with the
-- no-block-comment floor beneath them.
--
-- NO NAMED PERSON WITH A MEMBER ROW IS BUILT. The rule of assertion 3
-- refuses that row, so the clause of is_group_gift_member() that answers
-- false for a named person cannot be reached live. It is held by assertion
-- 6's reading of the deployed definition. The function is called for the
-- people this fixture can build: for1 is named on Ggr Surprise with no member
-- row there, and has a member row in Ggr Plain, where nobody is named, so
-- assertions 8 and 9 show it answers for1 gift by gift.
--
-- THE CASCADES ARE RUN LIVE (assertions 11-12), because they raise nothing:
-- a cascade deletes a name after its gift's row or its person's row is gone,
-- and the removal rule lets exactly that through. Each first reads the names
-- it expects to see deleted, so neither passes on a name that was never
-- there.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role, each gift's names after its member rows,
-- which the rule of assertion 4 allows because nobody named on a gift has a
-- member row in it or made it. Each person is signed in as the website signs
-- them in: request.jwt.claims and role are set around each call and each
-- read, and `role` goes back to the captured current_user before every
-- catalog read and every read that verifies a write. The two deletes run as
-- the connecting role.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role      text;
  v_checks         int := 0;
  v_maker          text := 'user_ggr_maker';
  v_member         text := 'user_ggr_member';
  v_for1           text := 'user_ggr_for1';
  v_for2           text := 'user_ggr_for2';
  v_out            text := 'user_ggr_out';
  v_group          uuid;
  v_surprise       uuid;
  v_plain          uuid;
  v_going          uuid;
  v_count          int;
  v_count2         int;
  v_count3         int;
  v_count4         int;
  v_count5         int;
  v_count6         int;
  v_rls            boolean;
  v_api_privs      boolean[];
  v_service_privs  boolean[];
  v_secdef         boolean;
  v_volatile       text;
  v_config         text[];
  v_bool           boolean;
  v_bool2          boolean;
  v_bool3          boolean;
  v_bool4          boolean;
  v_text           text;
  v_text2          text;
  v_text3          text;
  v_def            text;
  v_def2           text;
  v_def3           text;
  v_qual           text;
  v_roles          text;
  -- A block-comment opener, built so this file holds none itself.
  v_block_open     text := '/' || '*';
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_maker,  'ggrmaker',  'Ggr Maker'),
           (v_member, 'ggrmember', 'Ggr Member'),
           (v_for1,   'ggrfor1',   'Ggr For1'),
           (v_for2,   'ggrfor2',   'Ggr For2'),
           (v_out,    'ggrout',    'Ggr Out');

  -- maker makes Ggr Family, so add_group_creator_as_owner() makes maker its
  -- owner; member, for1 and for2 join it. out is in no group of this file.
  insert into groups (name, type, invite_code, created_by)
    values ('Ggr Family', 'family', 'GGRFAM01', v_maker)
    returning id into v_group;

  insert into group_members (group_id, user_id, role)
    values (v_group, v_member, 'member'),
           (v_group, v_for1,   'member'),
           (v_group, v_for2,   'member');

  -- Three gifts, each made by maker in Ggr Family.
  insert into group_gifts (group_id, name, created_by)
    values (v_group, 'Ggr Surprise', v_maker)
    returning id into v_surprise;

  insert into group_gifts (group_id, name, created_by)
    values (v_group, 'Ggr Plain', v_maker)
    returning id into v_plain;

  insert into group_gifts (group_id, name, created_by)
    values (v_group, 'Ggr Going', v_maker)
    returning id into v_going;

  -- Member rows: maker and member in Ggr Surprise, maker and for1 in Ggr
  -- Plain, maker alone in Ggr Going.
  insert into group_gift_members (group_gift_id, user_id)
    values (v_surprise, v_maker),
           (v_surprise, v_member),
           (v_plain,    v_maker),
           (v_plain,    v_for1),
           (v_going,    v_maker);

  -- Names, after the member rows: Ggr Surprise is for for1 and for2, Ggr
  -- Going for for1, Ggr Plain for nobody. Nobody named on a gift is in it or
  -- made it.
  insert into group_gift_recipients (group_gift_id, user_id)
    values (v_surprise, v_for1),
           (v_surprise, v_for2),
           (v_going,    v_for1);

  -- Ggr Surprise's chat: one message, by maker.
  insert into messages (group_gift_id, user_id, content)
    values (v_surprise, v_maker, 'Ggr from maker');

  ---------------------------------------------------------------------------
  -- Assertion 1: group_gift_recipients has row-level security on and no
  -- policy. Neither authenticated nor anon holds SELECT, INSERT, UPDATE or
  -- DELETE on it; service_role holds SELECT, INSERT and DELETE, and not
  -- TRUNCATE, which would not run the row trigger that guards removal.
  ---------------------------------------------------------------------------
  select c.relrowsecurity into v_rls
    from pg_class c
   where c.oid = 'public.group_gift_recipients'::regclass;

  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename = 'group_gift_recipients';

  select array[has_table_privilege('authenticated', 'public.group_gift_recipients', 'SELECT'),
               has_table_privilege('authenticated', 'public.group_gift_recipients', 'INSERT'),
               has_table_privilege('authenticated', 'public.group_gift_recipients', 'UPDATE'),
               has_table_privilege('authenticated', 'public.group_gift_recipients', 'DELETE'),
               has_table_privilege('anon', 'public.group_gift_recipients', 'SELECT'),
               has_table_privilege('anon', 'public.group_gift_recipients', 'INSERT'),
               has_table_privilege('anon', 'public.group_gift_recipients', 'UPDATE'),
               has_table_privilege('anon', 'public.group_gift_recipients', 'DELETE')],
         array[has_table_privilege('service_role', 'public.group_gift_recipients', 'SELECT'),
               has_table_privilege('service_role', 'public.group_gift_recipients', 'INSERT'),
               has_table_privilege('service_role', 'public.group_gift_recipients', 'DELETE')],
         has_table_privilege('service_role', 'public.group_gift_recipients', 'TRUNCATE')
    into v_api_privs, v_service_privs, v_bool;

  if v_rls is distinct from true or v_count <> 0
     or true = any(v_api_privs) or false = any(v_service_privs)
     or v_bool is distinct from false then
    raise exception
      'SCHEMA FAIL: group_gift_recipients has relrowsecurity % and % polic(y/ies); SELECT, INSERT, UPDATE and DELETE held by authenticated, then by anon: %; SELECT, INSERT and DELETE held by service_role: %; TRUNCATE held by service_role: %; expected true, 0, all false, all true and false',
      v_rls, v_count, v_api_privs, v_service_privs, v_bool;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: its primary key is (group_gift_id, user_id), and it has
  -- exactly two foreign keys, each on one column and on delete cascade
  -- (confdeltype 'c'): group_gift_id to group_gifts, and user_id to
  -- user_profiles.
  ---------------------------------------------------------------------------
  select string_agg(a.attname::text, ',' order by k.n)
    into v_text
    from pg_constraint c
   cross join lateral unnest(c.conkey) with ordinality as k(attnum, n)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
   where c.conrelid = 'public.group_gift_recipients'::regclass
     and c.contype = 'p';

  select count(*),
         count(*) filter (where cardinality(c.conkey) = 1
                            and a.attname = 'group_gift_id'
                            and c.confrelid = 'public.group_gifts'::regclass
                            and c.confdeltype = 'c'),
         count(*) filter (where cardinality(c.conkey) = 1
                            and a.attname = 'user_id'
                            and c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'c')
    into v_count, v_count2, v_count3
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
   where c.conrelid = 'public.group_gift_recipients'::regclass
     and c.contype = 'f';

  if v_text is distinct from 'group_gift_id,user_id'
     or v_count <> 2 or v_count2 <> 1 or v_count3 <> 1 then
    raise exception
      'SCHEMA FAIL: group_gift_recipients has primary key (%) and % foreign key(s), % of them group_gift_id alone to group_gifts on delete cascade and % of them user_id alone to user_profiles on delete cascade; expected (group_gift_id,user_id), and 2, 1 and 1',
      v_text, v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: group_gift_members has exactly one enabled, non-internal
  -- trigger running reject_group_gift_recipient_as_member, and it fires
  -- after insert and after update, for each row, with no WHEN condition
  -- (tgtype 21: row 1 + insert 4 + update 16, with no before bit), so the
  -- row's own policy and the pin on its gift and person decide first.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where tg.tgtype = 21 and tg.tgqual is null)
    into v_count, v_count2
    from pg_trigger tg
   where tg.tgrelid = 'public.group_gift_members'::regclass
     and tg.tgfoid = 'public.reject_group_gift_recipient_as_member()'::regprocedure
     and not tg.tgisinternal
     and tg.tgenabled = 'O';

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'GUARD FAIL: group_gift_members has % enabled trigger(s) running reject_group_gift_recipient_as_member, % of them after insert and update, for each row, with no condition; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: group_gift_recipients has exactly one enabled, non-internal
  -- trigger running each of its three rules, each for each row with no WHEN
  -- condition: reject_group_gift_member_as_recipient before insert (tgtype
  -- 7: row 1 + before 2 + insert 4); reject_parent_reassignment, given
  -- group_gift_id and user_id, before update (tgtype 19: row 1 + before 2 +
  -- update 16); and reject_group_gift_recipient_removal before delete
  -- (tgtype 11: row 1 + before 2 + delete 8). tgargs holds each argument
  -- followed by a zero byte.
  ---------------------------------------------------------------------------
  select count(*) filter (where tg.tgfoid = 'public.reject_group_gift_member_as_recipient()'::regprocedure),
         count(*) filter (where tg.tgfoid = 'public.reject_group_gift_member_as_recipient()'::regprocedure
                            and tg.tgtype = 7 and tg.tgqual is null),
         count(*) filter (where tg.tgfoid = 'public.reject_parent_reassignment()'::regprocedure),
         count(*) filter (where tg.tgfoid = 'public.reject_parent_reassignment()'::regprocedure
                            and tg.tgtype = 19 and tg.tgqual is null
                            and tg.tgnargs = 2
                            and tg.tgargs = (convert_to('group_gift_id', 'UTF8') || decode('00', 'hex')
                                             || convert_to('user_id', 'UTF8') || decode('00', 'hex'))),
         count(*) filter (where tg.tgfoid = 'public.reject_group_gift_recipient_removal()'::regprocedure),
         count(*) filter (where tg.tgfoid = 'public.reject_group_gift_recipient_removal()'::regprocedure
                            and tg.tgtype = 11 and tg.tgqual is null)
    into v_count, v_count2, v_count3, v_count4, v_count5, v_count6
    from pg_trigger tg
   where tg.tgrelid = 'public.group_gift_recipients'::regclass
     and not tg.tgisinternal
     and tg.tgenabled = 'O';

  if v_count <> 1 or v_count2 <> 1 or v_count3 <> 1 or v_count4 <> 1
     or v_count5 <> 1 or v_count6 <> 1 then
    raise exception
      'GUARD FAIL: group_gift_recipients has % enabled trigger(s) running reject_group_gift_member_as_recipient (% before insert, for each row, with no condition), % running reject_parent_reassignment (% before update, for each row, with no condition, on group_gift_id and user_id) and % running reject_group_gift_recipient_removal (% before delete, for each row, with no condition); expected exactly 1 of each',
      v_count, v_count2, v_count3, v_count4, v_count5, v_count6;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: the three trigger functions are SECURITY DEFINER with
  -- search_path pinned, and no API role (authenticated, anon, service_role)
  -- may execute them. Each deployed definition holds no block comment, and
  -- holds its refusal on a line of its own (so not line-commented). Each
  -- refusal sits directly under the condition that guards it, read line by
  -- line: every line of the condition whole, on its own and in order, then
  -- the raise on the next line, so a condition with a line changed, dropped
  -- or added fails here. The two that lock the gift's row lock it for no key
  -- update on a line of its own, before the refusal.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where p.prosecdef
                            and coalesce('search_path=public' = any(p.proconfig), false)
                            and not has_function_privilege('authenticated', p.oid, 'execute')
                            and not has_function_privilege('anon', p.oid, 'execute')
                            and not has_function_privilege('service_role', p.oid, 'execute'))
    into v_count, v_count2
    from pg_proc p
   where p.oid in ('public.reject_group_gift_recipient_as_member()'::regprocedure,
                   'public.reject_group_gift_member_as_recipient()'::regprocedure,
                   'public.reject_group_gift_recipient_removal()'::regprocedure);

  if v_count <> 3 or v_count2 <> 3 then
    raise exception
      'GUARD FAIL: of % trigger function(s) found, % are SECURITY DEFINER with search_path=public and executable by none of authenticated, anon and service_role; expected 3 of 3',
      v_count, v_count2;
  end if;

  v_def := pg_get_functiondef('public.reject_group_gift_recipient_as_member()'::regprocedure);
  v_def2 := pg_get_functiondef('public.reject_group_gift_member_as_recipient()'::regprocedure);
  v_def3 := pg_get_functiondef('public.reject_group_gift_recipient_removal()'::regprocedure);

  if position(v_block_open in v_def) <> 0
     or position(v_block_open in v_def2) <> 0
     or position(v_block_open in v_def3) <> 0 then
    raise exception
      'GUARD FAIL: a block comment opens at character % of reject_group_gift_recipient_as_member, % of reject_group_gift_member_as_recipient and % of reject_group_gift_recipient_removal; expected 0 in all three',
      position(v_block_open in v_def), position(v_block_open in v_def2),
      position(v_block_open in v_def3);
  end if;

  if not v_def ~ '(?n)^\s*perform 1 from group_gifts where id = new\.group_gift_id for no key update;$'
     or not v_def ~ '(?n)^\s*raise exception ''GROUP GIFT: a person a group gift is for cannot be in it'' using errcode = ''check_violation'';$'
     or not v_def ~ '(?n)^\s*if exists \(select 1 from group_gift_recipients\n\s*where group_gift_id = new\.group_gift_id\n\s*and user_id = new\.user_id\) then\n\s*raise exception ''GROUP GIFT: a person a group gift is for cannot be in it'' using errcode = ''check_violation'';$'
     or position('for no key update;' in v_def) > position('raise exception' in v_def) then
    raise exception
      'GUARD FAIL: reject_group_gift_recipient_as_member no longer locks the gift''s row for no key update and then refuses a member row for a person named on the gift, directly under its condition (a group_gift_recipients row for the row''s gift and person), each line whole and on its own, not line-commented (lock at character %, condition at %, refusal at %; expected all three present, the lock first, the refusal on the line after the condition)',
      position('for no key update;' in v_def),
      position('if exists (select 1 from group_gift_recipients' in v_def),
      position('raise exception' in v_def);
  end if;

  if not v_def2 ~ '(?n)^\s*select created_by into v_maker from group_gifts where id = new\.group_gift_id for no key update;$'
     or not v_def2 ~ '(?n)^\s*raise exception ''GROUP GIFT: someone in a group gift, or its maker, cannot be a person it is for'' using errcode = ''check_violation'';$'
     or not v_def2 ~ '(?n)^\s*if new\.user_id = v_maker\n\s*or exists \(select 1 from group_gift_members\n\s*where group_gift_id = new\.group_gift_id\n\s*and user_id = new\.user_id\) then\n\s*raise exception ''GROUP GIFT: someone in a group gift, or its maker, cannot be a person it is for'' using errcode = ''check_violation'';$'
     or position('for no key update;' in v_def2) > position('raise exception' in v_def2) then
    raise exception
      'GUARD FAIL: reject_group_gift_member_as_recipient no longer locks the gift''s row for no key update and then refuses a name for someone in the gift or for its maker, directly under its condition (the name''s person is the maker, or a group_gift_members row holds the gift and person), each line whole and on its own, not line-commented (lock at character %, condition at %, refusal at %; expected all three present, the lock first, the refusal on the line after the condition)',
      position('for no key update;' in v_def2),
      position('if new.user_id = v_maker' in v_def2),
      position('raise exception' in v_def2);
  end if;

  if not v_def3 ~ '(?n)^\s*raise exception ''GROUP GIFT: who a group gift is for cannot be changed'' using errcode = ''check_violation'';$'
     or not v_def3 ~ '(?n)^\s*if exists \(select 1 from group_gifts where id = old\.group_gift_id\)\n\s*and exists \(select 1 from user_profiles where id = old\.user_id\) then\n\s*raise exception ''GROUP GIFT: who a group gift is for cannot be changed'' using errcode = ''check_violation'';$' then
    raise exception
      'GUARD FAIL: reject_group_gift_recipient_removal no longer refuses the delete of a name directly under its condition (the name''s gift exists and its person exists), each line whole and on its own, not line-commented (condition at character %, refusal at %; expected both present, the refusal on the line after the condition)',
      position('if exists (select 1 from group_gifts where id = old.group_gift_id)' in v_def3),
      position('raise exception' in v_def3);
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: is_group_gift_member(uuid, text) is SECURITY DEFINER and
  -- stable (provolatile 's'), with search_path pinned. Its definition holds
  -- no block comment and names group_gift_recipients, requesting_user_id()
  -- and is_service_context(); and it holds, each on a line of its own, its
  -- pin (the person asked about is the caller, or the caller bypasses
  -- row-level security) and the clause that answers false for a person named
  -- on the gift.
  ---------------------------------------------------------------------------
  select p.prosecdef, p.provolatile::text, p.proconfig
    into v_secdef, v_volatile, v_config
    from pg_proc p
   where p.oid = 'public.is_group_gift_member(uuid, text)'::regprocedure;

  v_def := pg_get_functiondef('public.is_group_gift_member(uuid, text)'::regprocedure);

  v_bool := v_def ~ '(?n)^\s*p_user_id is not distinct from \(select public\.requesting_user_id\(\)\)$'
            and v_def ~ '(?n)^\s*or public\.is_service_context\(\)$'
            and v_def ~ '(?n)^\s*\) and not exists \($'
            and v_def ~ '(?n)^\s*select 1 from public\.group_gift_recipients r$'
            and v_def ~ '(?n)^\s*where r\.group_gift_id = p_group_gift_id and r\.user_id = p_user_id$';

  if v_secdef is distinct from true or v_volatile is distinct from 's'
     or not coalesce('search_path=public' = any(v_config), false)
     or position(v_block_open in v_def) <> 0
     or position('group_gift_recipients' in v_def) = 0
     or position('requesting_user_id()' in v_def) = 0
     or position('is_service_context()' in v_def) = 0
     or v_bool is distinct from true then
    raise exception
      'GUARD FAIL: is_group_gift_member has prosecdef %, provolatile % and proconfig %; its definition has a block comment at character %, group_gift_recipients at %, requesting_user_id() at % and is_service_context() at %, and its pin and its clause for a named person each on a line of its own: %; expected true, s, search_path=public among proconfig, 0, the next three present, and true',
      v_secdef, v_volatile, v_config, position(v_block_open in v_def),
      position('group_gift_recipients' in v_def), position('requesting_user_id()' in v_def),
      position('is_service_context()' in v_def), v_bool;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: group_gift_members_select, a SELECT policy to
  -- authenticated, is the only SELECT or ALL policy on group_gift_members.
  -- Its qual goes through the gift's maker (created_by) and
  -- is_group_gift_member(), and holds no comparison of the row's own user_id
  -- with the caller, written either way round ("(user_id = " or
  -- "= user_id)"), so a person reads their own member row only as a member.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from pg_policies
   where schemaname = 'public'
     and tablename = 'group_gift_members'
     and cmd in ('SELECT', 'ALL');

  select count(*), max(qual), max(roles::text)
    into v_count2, v_qual, v_roles
    from pg_policies
   where schemaname = 'public'
     and tablename = 'group_gift_members'
     and policyname = 'group_gift_members_select'
     and cmd = 'SELECT';

  if v_count <> 1 or v_count2 <> 1 or v_roles is distinct from '{authenticated}'
     or v_qual is null
     or position('is_group_gift_member' in v_qual) = 0
     or position('created_by' in v_qual) = 0
     or position('(user_id = ' in v_qual) <> 0
     or position('= user_id)' in v_qual) <> 0 then
    raise exception
      'GUARD FAIL: group_gift_members has % SELECT or ALL polic(y/ies) and % SELECT policy named group_gift_members_select, to %, with qual %; expected 1 and 1, to {authenticated}, through is_group_gift_member and created_by, with no (user_id = comparison and no = user_id) comparison',
      v_count, v_count2, v_roles, v_qual;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: on Ggr Surprise, each person asking about themselves (the
  -- only question the function's pin answers), is_group_gift_member() is
  -- true for maker and member, who are in it, and false for for1, who is
  -- named on it, and for out, who has nothing to do with it.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ggr_maker","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.is_group_gift_member(v_surprise, 'user_ggr_maker') into v_bool;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ggr_member","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.is_group_gift_member(v_surprise, 'user_ggr_member') into v_bool2;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ggr_for1","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.is_group_gift_member(v_surprise, 'user_ggr_for1') into v_bool3;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ggr_out","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.is_group_gift_member(v_surprise, 'user_ggr_out') into v_bool4;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from true or v_bool2 is distinct from true
     or v_bool3 is distinct from false or v_bool4 is distinct from false then
    raise exception
      'GUARD FAIL: on Ggr Surprise is_group_gift_member answers % for maker, % for member, % for for1 (named on it) and % for out, each asking about themselves; expected true, true, false and false',
      v_bool, v_bool2, v_bool3, v_bool4;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: the function answers for1 gift by gift, not false for for1
  -- everywhere: asked by for1 about Ggr Plain, where for1 has a member row
  -- and nobody is named, it is true.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ggr_for1","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select public.is_group_gift_member(v_plain, 'user_ggr_for1') into v_bool;

  perform set_config('role', v_orig_role, true);

  if v_bool is distinct from true then
    raise exception
      'GUARD FAIL: on Ggr Plain, where for1 has a member row and is not named, is_group_gift_member answers % for for1 asking about themselves; expected true',
      v_bool;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: signed in as for1, no row of Ggr Surprise can be read: not
  -- its group_gifts row, not its member rows and not its message. Signed in
  -- as member, both its member rows and its message can.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_ggr_for1","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from group_gifts
   where id = v_surprise;

  select count(*) into v_count2
    from group_gift_members
   where group_gift_id = v_surprise;

  select count(*) into v_count3
    from messages
   where group_gift_id = v_surprise;

  perform set_config('request.jwt.claims',
    '{"sub":"user_ggr_member","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count4
    from group_gift_members
   where group_gift_id = v_surprise;

  select count(*) into v_count5
    from messages
   where group_gift_id = v_surprise;

  perform set_config('role', v_orig_role, true);

  if v_count <> 0 or v_count2 <> 0 or v_count3 <> 0
     or v_count4 <> 2 or v_count5 <> 1 then
    raise exception
      'GUARD FAIL: of Ggr Surprise, for1 (named on it) reads % group_gifts row(s), % member row(s) and % message(s), and member reads % member row(s) and % message(s); expected 0, 0 and 0, and 2 and 1',
      v_count, v_count2, v_count3, v_count4, v_count5;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: a gift's names go with it, and the removal rule lets that
  -- cascade through. Ggr Going is named for for1; the connecting role
  -- deletes the gift, the delete raises nothing (this line is reached), and
  -- no name of Ggr Going is left.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from group_gift_recipients
   where group_gift_id = v_going
     and user_id = v_for1;

  delete from group_gifts where id = v_going;
  get diagnostics v_count2 = row_count;

  select count(*) into v_count3
    from group_gift_recipients
   where group_gift_id = v_going;

  if v_count <> 1 or v_count2 <> 1 or v_count3 <> 0 then
    raise exception
      'CASCADE FAIL: Ggr Going had % name(s) for for1 before its delete, the delete removed % gift(s), and % name(s) of Ggr Going are left; expected 1, 1 and 0',
      v_count, v_count2, v_count3;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12: a person's names go with them, and nothing else does. Ggr
  -- Surprise is named for for1 and for2; the connecting role deletes for2's
  -- profile, the delete raises nothing, and Ggr Surprise keeps its row, its
  -- name for for1 alone, and its member rows for maker and member.
  ---------------------------------------------------------------------------
  select string_agg(r.user_id, ',' order by r.user_id) into v_text
    from group_gift_recipients r
   where r.group_gift_id = v_surprise;

  delete from user_profiles where id = 'user_ggr_for2';
  get diagnostics v_count = row_count;

  select count(*) into v_count2
    from group_gifts
   where id = v_surprise;

  select string_agg(r.user_id, ',' order by r.user_id) into v_text2
    from group_gift_recipients r
   where r.group_gift_id = v_surprise;

  select string_agg(m.user_id, ',' order by m.user_id) into v_text3
    from group_gift_members m
   where m.group_gift_id = v_surprise;

  if v_text is distinct from 'user_ggr_for1,user_ggr_for2'
     or v_count <> 1 or v_count2 <> 1
     or v_text2 is distinct from 'user_ggr_for1'
     or v_text3 is distinct from 'user_ggr_maker,user_ggr_member' then
    raise exception
      'CASCADE FAIL: Ggr Surprise was named for % before for2''s profile was deleted, and the delete removed % profile(s); Ggr Surprise now has % row(s), is named for % and has member rows for %; expected user_ggr_for1,user_ggr_for2 and 1, then 1, user_ggr_for1 and user_ggr_maker,user_ggr_member',
      v_text, v_count, v_count2, v_text2, v_text3;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 12 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 12', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_28_group_gift_recipients');
end $$;

select token as result from _harness_result;
