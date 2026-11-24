-- 20261124000001_item_details.sql: a wishlist item carries a list of details
-- (wishlist_items.details, jsonb), shaped by the check constraint
-- valid_item_details, which runs valid_item_details(). authenticated can
-- select the column, and whoever can see an item reads its details. This file
-- proves:
--
--   1. The column (assertion 1). wishlist_items.details is jsonb, not null,
--      with the default '[]'::jsonb.
--   2. The constraint (assertion 2). valid_item_details is a check constraint
--      on wishlist_items, validated, and Postgres prints its definition as
--      CHECK (valid_item_details(details)) once the schema name is taken out.
--   3. The function (assertion 3). valid_item_details(jsonb) is immutable,
--      has search_path pinned to public, and its source does not name
--      wishlist_items (it reads no table). authenticated and service_role may
--      execute it, which a check constraint needs since it runs as the role
--      that writes the row; anon may not.
--   4. What it accepts (assertion 4). It answers true for each of: the empty
--      list; one named entry; all five named kinds once each with five
--      entries of kind other (ten in all, the most a list can hold); a value
--      of exactly 100 characters; a value of 100 multi-byte characters (so
--      characters are counted, not bytes); an other entry whose label is
--      exactly 30 characters.
--   5. What it refuses (assertion 5). It answers false, and does not raise,
--      for each of: jsonb null, an object, a string, an array of a number,
--      an entry with no value, an entry with no kind, a kind that is not one
--      of the six, an empty value, a value of 101 characters, a value that is
--      a number, a label on a named kind, an other entry with no label, an
--      other entry with an empty label, an other entry with a label of 31
--      characters, a key that is not kind, value or label, a kind that is a
--      number, an other label that is a number, a named kind twice, other six
--      times, and eleven entries (which also breaks named-once). Every case is a value
--      passed to the function directly: a test file cannot catch an
--      exception, so no refused write is attempted, and the function's own
--      answer is what the constraint acts on.
--   6. The grant (assertion 6). authenticated holds SELECT on the column
--      details, and anon holds none.
--   7. Writes, live (assertion 7). owner, signed in, inserts an item with two
--      details and then updates them to a different list, in a different
--      order, with an other entry; each write changes one row, and the
--      details read back, as the connecting role and as owner's own select
--      as authenticated, are what was written, in order.
--   8. Reads, live (assertions 8-9). family, who shares a family group with
--      owner, reads the same list of the item, by selecting the column as
--      authenticated. outsider, who is in no group with owner, reads no row
--      of the item.
--
-- THE CONSTRAINT'S REFUSALS ARE NOT ATTEMPTED LIVE. A write the constraint
-- refuses raises, and one uncaught raise ends the whole batch this file is
-- sent as; the runner bans handlers file-wide. Assertion 2 holds that the
-- constraint is there and runs the function, and assertions 4 and 5 hold
-- what the function answers, so a refusal follows from the three together.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. Each impersonated read or write sets
-- request.jwt.claims and role around it, and `role` goes back to the captured
-- current_user before every catalog read and every read that verifies a
-- write.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role    text;
  v_checks       int := 0;
  v_owner        text := 'user_idet_owner';
  v_family       text := 'user_idet_family';
  v_outsider     text := 'user_idet_outsider';
  v_family_only  jsonb := '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}';
  v_first        jsonb := '[{"kind":"size","value":"M"},{"kind":"color","value":"Blue"}]';
  v_second       jsonb := '[{"kind":"other","label":"Scent","value":"Unscented"},{"kind":"size","value":"L"}]';
  v_group        uuid;
  v_item         uuid;
  v_typ          text;
  v_notnull      boolean;
  v_default      text;
  v_def          text;
  v_validated    boolean;
  v_count        int;
  v_count2       int;
  v_immutable    boolean;
  v_pinned       boolean;
  v_names_table  boolean;
  v_priv         boolean[];
  v_case         text;
  v_cases        text[];
  v_bad          text;
  v_authed_col   boolean;
  v_anon_col     boolean;
  v_read         jsonb;
  v_read2        jsonb;
  v_own_read     jsonb;
  v_own_read2    jsonb;
  v_all_ten      text :=
    '[{"kind":"size","value":"M"},{"kind":"color","value":"Red"},{"kind":"style","value":"Slim"},'
    '{"kind":"version","value":"Pro"},{"kind":"brand","value":"Acme"},'
    '{"kind":"other","label":"A","value":"1"},{"kind":"other","label":"B","value":"2"},'
    '{"kind":"other","label":"C","value":"3"},{"kind":"other","label":"D","value":"4"},'
    '{"kind":"other","label":"E","value":"5"}]';
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_owner,    'idetowner',    'Idet Owner'),
           (v_family,   'idetfamily',   'Idet Family'),
           (v_outsider, 'idetoutsider', 'Idet Outsider');

  -- owner makes Idet Family, so add_group_creator_as_owner() makes owner its
  -- owner; family joins it. outsider is in no group.
  insert into groups (name, type, invite_code, created_by)
    values ('Idet Family', 'family', 'IDETFAM1', v_owner)
    returning id into v_group;

  insert into group_members (group_id, user_id, role)
    values (v_group, v_family, 'member')
    on conflict do nothing;

  ---------------------------------------------------------------------------
  -- Assertion 1: details is jsonb, not null, default '[]'::jsonb.
  ---------------------------------------------------------------------------
  select a.atttypid::regtype::text, a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_typ, v_notnull, v_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.wishlist_items'::regclass
     and a.attname = 'details'
     and not a.attisdropped;

  if v_typ is distinct from 'jsonb' or v_notnull is distinct from true
     or v_default is distinct from '''[]''::jsonb' then
    raise exception
      'COLUMN FAIL: wishlist_items.details has type %, attnotnull % and default %; expected jsonb, true and ''[]''::jsonb',
      coalesce(v_typ, '<no such column>'), v_notnull, coalesce(v_default, '<no default>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: the check constraint valid_item_details is on wishlist_items,
  -- validated, and prints as CHECK (valid_item_details(details)) with the
  -- schema name taken out.
  ---------------------------------------------------------------------------
  select replace(pg_get_constraintdef(c.oid), 'public.', ''), c.convalidated
    into v_def, v_validated
    from pg_constraint c
   where c.conrelid = 'public.wishlist_items'::regclass
     and c.conname = 'valid_item_details'
     and c.contype = 'c';

  if v_def is distinct from 'CHECK (valid_item_details(details))'
     or v_validated is distinct from true then
    raise exception
      'CONSTRAINT FAIL: the constraint valid_item_details on wishlist_items reads % and is validated: %; expected CHECK (valid_item_details(details)), validated true',
      coalesce(v_def, '<no such constraint>'), v_validated;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: valid_item_details(jsonb) is immutable, has search_path
  -- pinned to public, and its source does not hold wishlist_items.
  -- authenticated and service_role may execute it, anon may not.
  ---------------------------------------------------------------------------
  select p.provolatile = 'i',
         coalesce('search_path=public' = any(p.proconfig), false),
         position('wishlist_items' in p.prosrc) > 0,
         array[has_function_privilege('authenticated', p.oid, 'execute'),
               has_function_privilege('service_role', p.oid, 'execute'),
               has_function_privilege('anon', p.oid, 'execute')]
    into v_immutable, v_pinned, v_names_table, v_priv
    from pg_proc p
   where p.oid = 'public.valid_item_details(jsonb)'::regprocedure;

  if v_immutable is distinct from true or v_pinned is distinct from true
     or v_names_table is distinct from false
     or v_priv is distinct from array[true, true, false] then
    raise exception
      'FUNCTION FAIL: valid_item_details is immutable: %; has search_path=public: %; its source names wishlist_items: %; execute held by authenticated, service_role and anon: %; expected true, true, false and {t,t,f}',
      v_immutable, v_pinned, v_names_table, v_priv;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: the function answers true for every valid list. Each case is
  -- a jsonb literal; the ones that fail are named in the message.
  ---------------------------------------------------------------------------
  v_cases := array[
    '[]',
    '[{"kind":"size","value":"M"}]',
    v_all_ten,
    '[{"kind":"size","value":"' || repeat('a', 100) || '"}]',
    '[{"kind":"size","value":"' || repeat('é', 100) || '"}]',
    '[{"kind":"other","label":"' || repeat('b', 30) || '","value":"x"}]'
  ];
  v_bad := '';

  foreach v_case in array v_cases loop
    if public.valid_item_details(v_case::jsonb) is distinct from true then
      v_bad := v_bad || left(v_case, 50) || ' | ';
    end if;
  end loop;

  if v_bad <> '' then
    raise exception
      'FUNCTION FAIL: valid_item_details did not answer true for: %; expected true for the empty list, one named entry, ten entries (five named kinds and five other), a value of 100 characters, a value of 100 multi-byte characters and an other label of 30 characters',
      v_bad;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: the function answers false, without raising, for every list
  -- of the wrong shape.
  ---------------------------------------------------------------------------
  v_cases := array[
    'null',
    '{}',
    '"x"',
    '[1]',
    '[{"kind":"size"}]',
    '[{"value":"M"}]',
    '[{"kind":"shape","value":"M"}]',
    '[{"kind":"size","value":""}]',
    '[{"kind":"size","value":"' || repeat('a', 101) || '"}]',
    '[{"kind":"size","value":5}]',
    '[{"kind":1,"value":"M"}]',
    '[{"kind":"other","label":5,"value":"x"}]',
    '[{"kind":"size","value":"M","label":"Size"}]',
    '[{"kind":"other","value":"x"}]',
    '[{"kind":"other","label":"","value":"x"}]',
    '[{"kind":"other","label":"' || repeat('b', 31) || '","value":"x"}]',
    '[{"kind":"size","value":"M","extra":1}]',
    '[{"kind":"size","value":"M"},{"kind":"size","value":"L"}]',
    '[{"kind":"other","label":"A","value":"1"},{"kind":"other","label":"B","value":"2"},'
      '{"kind":"other","label":"C","value":"3"},{"kind":"other","label":"D","value":"4"},'
      '{"kind":"other","label":"E","value":"5"},{"kind":"other","label":"F","value":"6"}]',
    -- Eleven entries. The 10-entry cap follows from "each named kind once" and "other at most 5", so this case also breaks named-once.
    left(v_all_ten, length(v_all_ten) - 1) || ',{"kind":"brand","value":"Again"}]'
  ];
  v_bad := '';

  foreach v_case in array v_cases loop
    if public.valid_item_details(v_case::jsonb) is distinct from false then
      v_bad := v_bad || left(v_case, 50) || ' | ';
    end if;
  end loop;

  if v_bad <> '' then
    raise exception
      'FUNCTION FAIL: valid_item_details did not answer false for: %; expected false for every list of the wrong shape',
      v_bad;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: authenticated holds SELECT on the column details; anon does
  -- not.
  ---------------------------------------------------------------------------
  select has_column_privilege('authenticated', 'public.wishlist_items', 'details', 'SELECT'),
         has_column_privilege('anon', 'public.wishlist_items', 'details', 'SELECT')
    into v_authed_col, v_anon_col;

  if v_authed_col is distinct from true or v_anon_col is distinct from false then
    raise exception
      'GRANT FAIL: authenticated holds SELECT on wishlist_items.details: %; anon holds it: %; expected true and false',
      v_authed_col, v_anon_col;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: owner, signed in, inserts an item with two details, then
  -- updates them to a different list. Each write changes one row, and both the
  -- connecting role and owner's own select (as authenticated) read back what
  -- was written, in order.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into wishlist_items (user_id, title, privacy_settings, details)
    values (v_owner, 'Idet Item', v_family_only, v_first)
    returning id into v_item;
  get diagnostics v_count = row_count;

  -- owner's own read of the column, still as authenticated.
  select w.details into v_own_read
    from wishlist_items w
   where w.id = v_item;

  perform set_config('role', v_orig_role, true);

  select w.details into v_read
    from wishlist_items w
   where w.id = v_item;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update wishlist_items
     set details = v_second
   where id = v_item;
  get diagnostics v_count2 = row_count;

  select w.details into v_own_read2
    from wishlist_items w
   where w.id = v_item;

  perform set_config('role', v_orig_role, true);

  select w.details into v_read2
    from wishlist_items w
   where w.id = v_item;

  if v_count <> 1 or v_read is distinct from v_first
     or v_count2 <> 1 or v_read2 is distinct from v_second
     or v_own_read is distinct from v_first or v_own_read2 is distinct from v_second then
    raise exception
      'WRITE FAIL: owner''s insert changed % row(s) and the details read back as % (expected 1 and %); owner''s update changed % row(s) and the details read back as % (expected 1 and %); owner''s own select as authenticated read % after the insert (expected %) and % after the update (expected %)',
      v_count, v_read, v_first, v_count2, v_read2, v_second, v_own_read, v_first, v_own_read2, v_second;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: family, who shares a family group with owner and can see
  -- the item, reads the same list by selecting the column as authenticated.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_family || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from wishlist_items w
   where w.id = v_item;

  select w.details into v_read
    from wishlist_items w
   where w.id = v_item;

  perform set_config('role', v_orig_role, true);

  if v_count <> 1 or v_read is distinct from v_second then
    raise exception
      'READ FAIL: % reads % row(s) of owner''s item (expected 1) and its details as % (expected %)',
      v_family, v_count, v_read, v_second;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: outsider, in no group with owner, reads no row of the item.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_outsider || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from wishlist_items w
   where w.id = v_item;

  perform set_config('role', v_orig_role, true);

  if v_count <> 0 then
    raise exception
      'READ FAIL: % reads % row(s) of owner''s item; expected 0',
      v_outsider, v_count;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 9 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 9', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_30_item_details');
end $$;

select token as result from _harness_result;
