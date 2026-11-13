-- 20261112000001_profile_fields_take_the_stored_choice.sql:
-- profile_field_takes_stored_choice(), a before-insert trigger on
-- profile_info that gives a new field its owner's stored choice (a field tied
-- to one group, or one whose owner has no stored choice, is left as given).
-- This file proves:
--
--   1. The trigger (assertions 1-5). It is on profile_info, enabled, fires
--      before insert for each row, and runs its function, which is SECURITY
--      INVOKER with search_path pinned and executable by no API role. Its
--      definition has no block comment, assigns no column of the new row
--      but privacy_settings (in any form of assignment) and never the row
--      itself, leaves a tied row alone, and reads the stored row for share.
--   2. What it does, live (assertions 6-13). p's stored choice is written as
--      {work,friends,work}, so each field p inserts must come out naming
--      ["friends", "work"]: once each, in the enum's order. A field carrying
--      the column default, one carrying another setting (whose other key is
--      kept), and one whose settings are not an object all take it, and so
--      does a new row written with confirm_anniversary_link's
--      `on conflict ... do update set field_value = excluded.field_value`.
--      The same statement on a row that exists changes its value and leaves
--      its setting as it was. n, with no stored choice, keeps exactly what
--      the insert carried; a field tied to one group is kept exactly as
--      given. A field the connecting role writes for q while p's claims are
--      set, as confirm_anniversary_link's body would, takes q's choice, not
--      p's.
--   3. A signed-in person cannot use an insert to learn or use another
--      person's choice (assertions 14-15). profile_info's only insert policy
--      refuses a row naming anyone but the caller; and the read the trigger
--      makes, run as p (the trigger is SECURITY INVOKER), finds nothing of
--      q's row, which exists.
--   4. The privileges the share lock needs (assertion 16). Every API role
--      that inserts into profile_info holds SELECT and UPDATE on
--      profile_visibility.
--
-- REFUSALS THAT RAISE ARE NOT ATTEMPTED LIVE. A signed-in insert naming
-- another person raises (42501, from profile_info's insert policy), and one
-- uncaught raise ends the whole batch this file is sent as; the runner bans
-- handlers file-wide (see 17_claim_lifecycle.sql's header). It is held by
-- the policy's own text and its population (assertion 14), and by the live,
-- non-raising read of assertion 15.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. Each impersonated insert sets
-- request.jwt.claims and role around it, and `role` goes back to the
-- captured current_user before every catalog read and every read that
-- verifies a write. Each insert reads its row_count.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role       text;
  v_checks          int := 0;
  v_p               text := 'user_ptake_p';
  v_n               text := 'user_ptake_n';
  v_q               text := 'user_ptake_q';
  v_group           uuid;
  v_tied            jsonb;
  v_def             text;
  v_enabled         text;
  v_secdef          boolean;
  v_config          text[];
  v_can_anon        boolean;
  v_can_authed      boolean;
  v_can_service     boolean;
  v_fn_def          text;
  v_count           int;
  v_count2          int;
  -- A block-comment opener, built so this file holds none itself.
  v_block_open      text := '/' || '*';
  v_settings        jsonb;
  v_settings2       jsonb;
  v_value           text;
  v_found_policies  text;
  v_expected_check  text := '(( SELECT requesting_user_id() AS requesting_user_id) = user_id)';
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_p, 'ptakep', 'Ptake P'),
           (v_n, 'ptaken', 'Ptake N'),
           (v_q, 'ptakeq', 'Ptake Q');

  -- add_group_creator_as_owner() adds p. The group exists only to give a
  -- tied field a real group id.
  insert into groups (name, type, invite_code, created_by)
    values ('Ptake Family', 'family', 'PTAKEFM1', v_p)
    returning id into v_group;

  v_tied := jsonb_build_object(
    'visibleToGroupTypes', '["custom"]'::jsonb,
    'restrictToGroup', v_group);

  -- p's choice written as only a direct write could store it: out of order,
  -- one kind twice. q's is family. n has none.
  insert into profile_visibility (user_id, visible_to_group_types)
    values (v_p, '{work,friends,work}'::public.group_type[]),
           (v_q, '{family}'::public.group_type[]);

  ---------------------------------------------------------------------------
  -- Assertions 1-2: the trigger, compared whole as 09_privacy_pins.sql
  -- compares its pins (a trigger demoted to AFTER, widened to UPDATE, or
  -- re-pointed at another function fails), and enabled for ordinary writes.
  ---------------------------------------------------------------------------
  select replace(pg_get_triggerdef(t.oid), 'FUNCTION public.', 'FUNCTION '),
         t.tgenabled::text
    into v_def, v_enabled
    from pg_trigger t
   where t.tgrelid = 'public.profile_info'::regclass
     and t.tgname = 'profile_field_takes_stored_choice'
     and not t.tgisinternal;

  if v_def is distinct from
     'CREATE TRIGGER profile_field_takes_stored_choice BEFORE INSERT ON public.profile_info FOR EACH ROW EXECUTE FUNCTION profile_field_takes_stored_choice()'
  then
    raise exception
      'TRIGGER FAIL: profile_info''s stored-choice trigger is missing or altered. Found: %',
      coalesce(v_def, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  if v_enabled is distinct from 'O' then
    raise exception
      'TRIGGER FAIL: profile_field_takes_stored_choice has tgenabled %, expected O (fires for ordinary writes)',
      coalesce(v_enabled, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertions 3-4: its function runs as the inserting role, with
  -- search_path pinned, and no API role may execute it.
  ---------------------------------------------------------------------------
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p
   where p.oid = 'public.profile_field_takes_stored_choice()'::regprocedure;

  if v_secdef is distinct from false
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: profile_field_takes_stored_choice has prosecdef % and proconfig %, expected prosecdef false (security invoker) and search_path=public among proconfig',
      v_secdef, v_config;
  end if;
  v_checks := v_checks + 1;

  select has_function_privilege('anon', 'public.profile_field_takes_stored_choice()', 'execute'),
         has_function_privilege('authenticated', 'public.profile_field_takes_stored_choice()', 'execute'),
         has_function_privilege('service_role', 'public.profile_field_takes_stored_choice()', 'execute')
    into v_can_anon, v_can_authed, v_can_service;

  if v_can_anon is distinct from false or v_can_authed is distinct from false
     or v_can_service is distinct from false then
    raise exception
      'GUARD FAIL: profile_field_takes_stored_choice is executable by anon: %, authenticated: %, service_role: %; expected false for all three',
      v_can_anon, v_can_authed, v_can_service;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: its definition has no block comment (the floor beneath the
  -- line-anchored patterns); assigns no column of the new row but
  -- privacy_settings, whether with := or =, never selects into the new row
  -- and never assigns the row itself (so it can never change whose row it
  -- is); leaves a tied row alone; and reads the stored row for share.
  ---------------------------------------------------------------------------
  v_fn_def := pg_get_functiondef('public.profile_field_takes_stored_choice()'::regprocedure);

  select count(*) into v_count
    from regexp_matches(v_fn_def, '(?n)^\s*new\.[a-z_]+\s*:?=', 'g') m;

  select count(*) into v_count2
    from regexp_matches(v_fn_def, '(?n)^\s*new\.privacy_settings\s*:?=', 'g') m;

  if position(v_block_open in v_fn_def) <> 0
     or v_count <> 1 or v_count2 <> 1
     or v_fn_def ~* '\minto\s+new\M'
     or v_fn_def ~ '(?n)^\s*new\s*:?='
     or not v_fn_def ~
       '(?n)^\s*if coalesce\(new\.privacy_settings->''restrictToGroup'', ''null''::jsonb\) <> ''null''::jsonb then$'
     or not v_fn_def ~ '(?n)^\s*return new;$'
     or not v_fn_def ~ '(?n)^\s*for share;$'
  then
    raise exception
      'GUARD FAIL: profile_field_takes_stored_choice''s definition has a block comment at character % (expected 0), assigns % column(s) of the new row of which % is privacy_settings (expected 1 and 1), selects into or assigns the new row itself, or no longer leaves a tied row alone and reads the stored row for share',
      position(v_block_open in v_fn_def), v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: p inserts a field carrying the column default (all four
  -- kinds). It ends naming exactly p's stored kinds, once each, in order.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_p || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into profile_info (user_id, category, field_name, field_value)
    values (v_p, 'sizes', 'shoe_size', '9');
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select privacy_settings into v_settings
    from profile_info
   where user_id = v_p and category = 'sizes' and field_name = 'shoe_size';

  if v_count <> 1
     or v_settings is distinct from '{"visibleToGroupTypes": ["friends", "work"], "restrictToGroup": null}'::jsonb then
    raise exception
      'TRIGGER FAIL: % inserting a field with the column default wrote % row(s) reading %; expected 1 reading {"visibleToGroupTypes": ["friends", "work"], "restrictToGroup": null}',
      v_p, v_count, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: the same when the insert carries some other setting; a key
  -- other than the two the trigger sets is kept.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_p, 'sizes', 'shirt_size', 'M',
            '{"visibleToGroupTypes": ["family", "custom"], "restrictToGroup": null, "overrides": {"x": "y"}}'::jsonb);
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select privacy_settings into v_settings
    from profile_info
   where user_id = v_p and category = 'sizes' and field_name = 'shirt_size';

  if v_count <> 1
     or v_settings is distinct from
        '{"visibleToGroupTypes": ["friends", "work"], "restrictToGroup": null, "overrides": {"x": "y"}}'::jsonb then
    raise exception
      'TRIGGER FAIL: % inserting a field naming family and custom wrote % row(s) reading %; expected 1 reading p''s kinds, no group, and the overrides kept',
      v_p, v_count, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: settings that are not an object start from an empty one.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_p, 'sizes', 'hat_size', '7', '"family"'::jsonb);
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select privacy_settings into v_settings
    from profile_info
   where user_id = v_p and category = 'sizes' and field_name = 'hat_size';

  if v_count <> 1
     or v_settings is distinct from '{"visibleToGroupTypes": ["friends", "work"], "restrictToGroup": null}'::jsonb then
    raise exception
      'TRIGGER FAIL: % inserting a field whose settings are a string wrote % row(s) reading %; expected 1 object naming p''s kinds and no group',
      v_p, v_count, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: confirm_anniversary_link's statement shape on a new row.
  -- The trigger runs on the proposed row, so the row inserted carries p's
  -- kinds, not the empty list the statement gave.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_p, 'sizes', 'ring_size', '6',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb)
    on conflict on constraint profile_info_user_id_category_field_name_key
    do update set field_value = excluded.field_value;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select privacy_settings, field_value into v_settings, v_value
    from profile_info
   where user_id = v_p and category = 'sizes' and field_name = 'ring_size';

  if v_count <> 1 or v_value is distinct from '6'
     or v_settings is distinct from '{"visibleToGroupTypes": ["friends", "work"], "restrictToGroup": null}'::jsonb then
    raise exception
      'TRIGGER FAIL: % upserting a new field wrote % row(s) reading value % and settings %; expected 1 row, value 6, naming p''s kinds and no group',
      v_p, v_count, v_value, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: the same statement on that row, now existing, changes its
  -- value and leaves its setting exactly as it was. The setting is first
  -- made one the trigger would never write (an update, which the
  -- before-insert trigger does not see), so a statement that also wrote
  -- privacy_settings, or a trigger that also fired on update, fails here.
  ---------------------------------------------------------------------------
  update profile_info
     set privacy_settings = '{"visibleToGroupTypes": ["custom"], "restrictToGroup": null}'::jsonb
   where user_id = v_p and category = 'sizes' and field_name = 'ring_size';

  perform set_config('role', 'authenticated', true);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_p, 'sizes', 'ring_size', '7',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}'::jsonb)
    on conflict on constraint profile_info_user_id_category_field_name_key
    do update set field_value = excluded.field_value;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select count(*), max(field_value), max(privacy_settings::text)::jsonb
    into v_count2, v_value, v_settings
    from profile_info
   where user_id = v_p and category = 'sizes' and field_name = 'ring_size';

  if v_count <> 1 or v_count2 <> 1 or v_value is distinct from '7'
     or v_settings is distinct from '{"visibleToGroupTypes": ["custom"], "restrictToGroup": null}'::jsonb then
    raise exception
      'TRIGGER FAIL: % upserting an existing field changed % row(s), leaving % row(s) with value % and settings %; expected 1 changed, 1 row, value 7, settings {"visibleToGroupTypes": ["custom"], "restrictToGroup": null} as they were',
      v_p, v_count, v_count2, v_value, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: n, with no stored choice, keeps exactly what the insert
  -- carried: the column default on one field, another setting on another.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_n || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into profile_info (user_id, category, field_name, field_value)
    values (v_n, 'sizes', 'shoe_size', '10');
  get diagnostics v_count = row_count;

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_n, 'sizes', 'shirt_size', 'L',
            '{"visibleToGroupTypes": ["custom"], "restrictToGroup": null, "overrides": {"a": "b"}}'::jsonb);
  get diagnostics v_count2 = row_count;

  perform set_config('role', v_orig_role, true);

  select privacy_settings into v_settings
    from profile_info
   where user_id = v_n and category = 'sizes' and field_name = 'shoe_size';

  select privacy_settings into v_settings2
    from profile_info
   where user_id = v_n and category = 'sizes' and field_name = 'shirt_size';

  if v_count <> 1 or v_count2 <> 1
     or v_settings is distinct from
        '{"visibleToGroupTypes": ["family", "friends", "work", "custom"], "restrictToGroup": null}'::jsonb
     or v_settings2 is distinct from
        '{"visibleToGroupTypes": ["custom"], "restrictToGroup": null, "overrides": {"a": "b"}}'::jsonb then
    raise exception
      'TRIGGER FAIL: % (no stored choice) wrote % and % row(s), reading % and %; expected 1 and 1, the column default and the setting as given',
      v_n, v_count, v_count2, v_settings, v_settings2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12: p inserts a field tied to one group. It is kept exactly
  -- as given, although p has a stored choice.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_p || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_p, 'sizes', 'pants_size', '32', v_tied);
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select privacy_settings into v_settings
    from profile_info
   where user_id = v_p and category = 'sizes' and field_name = 'pants_size';

  if v_count <> 1 or v_settings is distinct from v_tied then
    raise exception
      'TRIGGER FAIL: % inserting a field tied to group % wrote % row(s) reading %; expected 1 reading exactly %',
      v_p, v_group, v_count, v_settings, v_tied;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 13: the connecting role writes q's anniversary while p's
  -- claims are set: confirm_anniversary_link's insert, run as its body runs
  -- (as the owner of the tables, on the confirming partner's request). The
  -- new row takes q's choice, not p's.
  ---------------------------------------------------------------------------
  insert into profile_info (user_id, category, field_name, field_value)
    values (v_q, 'dates', 'anniversary', '2020-06-15')
    on conflict on constraint profile_info_user_id_category_field_name_key
    do update set field_value = excluded.field_value;
  get diagnostics v_count = row_count;

  select privacy_settings into v_settings
    from profile_info
   where user_id = v_q and category = 'dates' and field_name = 'anniversary';

  if v_count <> 1
     or v_settings is distinct from '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}'::jsonb then
    raise exception
      'TRIGGER FAIL: the anniversary written for % on %''s request wrote % row(s) reading %; expected 1 reading q''s {"visibleToGroupTypes": ["family"], "restrictToGroup": null}',
      v_q, v_p, v_count, v_settings;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 14: an insert naming another person is refused. profile_info
  -- has one permissive policy that admits inserts (INSERT or ALL), for
  -- authenticated alone, and its check is exactly the caller-is-the-owner
  -- comparison. Row-level security checks the row after the trigger has
  -- run, and the trigger never changes user_id (assertion 5), so such an
  -- insert raises and stores nothing; it is not attempted live (see the
  -- header). The message prints every such policy found, to compare.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where cmd = 'INSERT'
                            and roles = '{authenticated}'::name[]
                            and with_check = v_expected_check)
    into v_count, v_count2
    from pg_policies
   where schemaname = 'public'
     and tablename = 'profile_info'
     and cmd in ('INSERT', 'ALL')
     and permissive = 'PERMISSIVE';

  select coalesce(string_agg(format('%s %s %s', cmd, roles::text, coalesce(with_check, '<none>')), '; '), '<none>')
    into v_found_policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'profile_info'
     and cmd in ('INSERT', 'ALL')
     and permissive = 'PERMISSIVE';

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'RLS FAIL: profile_info has % permissive INSERT or ALL polic(y/ies), % of them for authenticated alone with check exactly %; expected 1 and 1. Found: %',
      v_count, v_count2, v_expected_check, v_found_policies;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 15: the trigger runs as the inserting role (assertion 3), so
  -- when p inserts, it reads profile_visibility as p. That read, made as p
  -- for q's row, finds nothing, although the row exists: p's insert can
  -- neither learn nor use q's choice.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from (select 1 from profile_visibility where user_id = v_q for share) as r;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count2
    from profile_visibility
   where user_id = v_q;

  if v_count <> 0 or v_count2 <> 1 then
    raise exception
      'RLS FAIL: as %, the trigger''s read of %''s stored row found % row(s), and % row(s) of it exist; expected 0 found of 1',
      v_p, v_q, v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 16: the trigger's share lock needs UPDATE as well as SELECT on
  -- profile_visibility; every API role that inserts into profile_info holds
  -- both.
  ---------------------------------------------------------------------------
  if not has_table_privilege('authenticated', 'public.profile_visibility', 'SELECT')
     or not has_table_privilege('authenticated', 'public.profile_visibility', 'UPDATE')
     or not has_table_privilege('service_role', 'public.profile_visibility', 'SELECT')
     or not has_table_privilege('service_role', 'public.profile_visibility', 'UPDATE') then
    raise exception
      'GUARD FAIL: a role that inserts into profile_info lacks SELECT or UPDATE on profile_visibility, so its inserts would fail on the trigger''s share lock';
  end if;
  v_checks := v_checks + 1;

  if v_checks < 16 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 16', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_24_profile_fields_take_the_stored_choice');
end $$;

select token as result from _harness_result;
