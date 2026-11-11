-- 20261111000000_shopping_links.sql: the four columns that tie a tracked gift
-- to its item, person and occasion; set_claim_occasion(), which moves the
-- caller's own held claim to another occasion; and D14, which stops
-- get_or_create_celebrated_occasion() recording which giver created someone
-- else's birthday or anniversary row, and clears what it recorded.
--
-- REFUSALS ARE NOT ATTEMPTED LIVE. set_claim_occasion() refuses by raising,
-- and one uncaught raise ends the whole batch this file is sent as (see
-- 17_claim_lifecycle.sql's header, and 15_celebrated_materialization.sql's,
-- for the probe that confirmed it). The runner bans handlers file-wide. So
-- each refusal gets what 17 gives claim_wishlist_item's: a live, non-raising
-- check that the thing to refuse is really there (assertion 17), plus an
-- anchored source check against the deployed definition (assertions 19-21),
-- with the no-block-comment floor beneath them (assertion 18). Every regex
-- carries its own (?n), every pattern is line-anchored (^\s*...$), and every
-- pg_proc lookup is scoped by exact ::regprocedure identity.
--
-- The patterns are plain string literals. standard_conforming_strings is on,
-- so a backslash in one is an ordinary character: `\s`, `\(` and `\.` reach
-- the regex engine as two characters each, and the ARE compiler reads them
-- as escapes. A quote inside a pattern is doubled, as in any literal.
--
-- What line-anchoring proves, and what it does not, is set out in 17's
-- header and applies here unchanged: it stops a `--` line comment; the
-- no-block-comment floor (assertion 18) stops a block comment; neither sees
-- a guard's lines disconnected from each other, nor guard ordering.
--
-- The lapse rule in set_claim_occasion's lookup (a claim whose occasion has
-- passed is no longer the caller's to move) and its item-visibility conjunct
-- have no live check. Both refuse by raising, and no fixture can reach them
-- without ending the file. Assertion 20 anchors every line of them.
--
-- The live paths below (14-16) go through the group arm, the celebrant arm
-- and the null occasion. The partner arm has the anchored pattern and the
-- occurrence count of assertion 21 only.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. Calls run as the caller they test, so
-- `role` and `request.jwt.claims` are set around each one, and `role` goes
-- back to the captured current_user before every read that verifies what a
-- call wrote, and before every catalog read (17's header says why).

create temp table _harness_result (token text);

do $$
declare
  v_orig_role         text;
  v_checks            int := 0;
  v_owner             text := 'user_shoplink_owner';
  v_giver             text := 'user_shoplink_giver';
  v_giver2            text := 'user_shoplink_giver2';
  v_celeb             text := 'user_shoplink_celeb';
  v_group             uuid;
  v_item1             uuid;
  v_item2             uuid;
  v_xmas              uuid;
  v_bday              uuid;
  v_recipient         uuid;
  v_gift              uuid;
  v_count             int;
  v_count2            int;
  v_type              text;
  v_notnull           boolean;
  v_default           text;
  v_indexdef          text;
  v_secdef            boolean;
  v_config            text[];
  v_can_authed        boolean;
  v_can_anon          boolean;
  v_created_by        text;
  v_guard_defs        int;
  v_occid_matches     int;
  v_block_comment_pos int;
  v_created_by_pos    int;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_owner,  'shoplinkowner',  'Shoplink Owner'),
           (v_giver,  'shoplinkgiver',  'Shoplink Giver'),
           (v_giver2, 'shoplinkgiver2', 'Shoplink Giver2'),
           (v_celeb,  'shoplinkceleb',  'Shoplink Celebrant');

  insert into groups (name, type, invite_code, created_by)
    values ('Shoplink Family', 'family', 'SHOPLNK1', v_owner)
    returning id into v_group;

  -- add_group_creator_as_owner() already added v_owner. The giver, giver2
  -- and the celebrant join, so all four share "family": the owner's items
  -- are visible to both givers, and the celebrant's birthday to the giver.
  insert into group_members (group_id, user_id, role)
    values (v_group, v_giver, 'member'),
           (v_group, v_giver2, 'member'),
           (v_group, v_celeb, 'member')
    on conflict do nothing;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'Shoplink Item One',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item1;

  insert into wishlist_items (user_id, title, privacy_settings)
    values (v_owner, 'Shoplink Item Two',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}')
    returning id into v_item2;

  -- A group date in that group. 2030-12-25, the date 17's group-date
  -- fixture uses: a claim filed under it does not lapse until that day has
  -- passed, after which assertion 15's move would be refused.
  insert into occasions (group_id, kind, name, occasion_date, created_by)
    values (v_group, 'group_date', 'Shoplink Christmas', '2030-12-25'::date, v_owner)
    returning id into v_xmas;

  -- The celebrant's birthday, visible to "family". Dec 31 is never before
  -- today in the current year, so the row get_or_create_celebrated_occasion()
  -- makes from it never rolls and never lapses mid-file (15's Dec 31 anchor).
  insert into profile_info (user_id, category, field_name, field_value, privacy_settings)
    values (v_celeb, 'dates', 'birthday', '1990-12-31',
            '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}');

  -- giver2's active claim on item two, written directly (authenticated holds
  -- no INSERT on wishlist_claims). Assertion 17 needs it: a claim the giver
  -- does not hold, sitting on an item the giver can see.
  insert into wishlist_claims (item_id, occasion_id, claimed_by)
    values (v_item2, null, v_giver2);

  ---------------------------------------------------------------------------
  -- Assertions 1-4: the columns.
  ---------------------------------------------------------------------------
  select format_type(a.atttypid, a.atttypmod), a.attnotnull
    into v_type, v_notnull
    from pg_attribute a
   where a.attrelid = 'public.gift_recipients'::regclass
     and a.attname = 'person_id'
     and not a.attisdropped;

  if v_type is distinct from 'text' or v_notnull is distinct from false then
    raise exception
      'SCHEMA FAIL: gift_recipients.person_id has type % and attnotnull %, expected type text and nullable',
      v_type, v_notnull;
  end if;
  v_checks := v_checks + 1;

  select format_type(a.atttypid, a.atttypmod), a.attnotnull
    into v_type, v_notnull
    from pg_attribute a
   where a.attrelid = 'public.tracked_gifts'::regclass
     and a.attname = 'wishlist_item_id'
     and not a.attisdropped;

  if v_type is distinct from 'uuid' or v_notnull is distinct from false then
    raise exception
      'SCHEMA FAIL: tracked_gifts.wishlist_item_id has type % and attnotnull %, expected type uuid and nullable',
      v_type, v_notnull;
  end if;
  v_checks := v_checks + 1;

  select format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_type, v_notnull, v_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.tracked_gifts'::regclass
     and a.attname = 'from_list'
     and not a.attisdropped;

  if v_type is distinct from 'boolean' or v_notnull is distinct from true
     or v_default is distinct from 'false' then
    raise exception
      'SCHEMA FAIL: tracked_gifts.from_list has type %, attnotnull % and default %, expected type boolean, not null and default false',
      v_type, v_notnull, v_default;
  end if;
  v_checks := v_checks + 1;

  select format_type(a.atttypid, a.atttypmod), a.attnotnull
    into v_type, v_notnull
    from pg_attribute a
   where a.attrelid = 'public.tracked_gifts'::regclass
     and a.attname = 'occasion_id'
     and not a.attisdropped;

  if v_type is distinct from 'uuid' or v_notnull is distinct from false then
    raise exception
      'SCHEMA FAIL: tracked_gifts.occasion_id has type % and attnotnull %, expected type uuid and nullable',
      v_type, v_notnull;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertions 5-7: the foreign keys. Each counts the foreign keys whose
  -- only column is the new one, and how many of those reference the right
  -- table with on delete set null (confdeltype 'n'). Both must be exactly 1,
  -- so a second foreign key on the column fails too.
  ---------------------------------------------------------------------------
  select count(*),
         count(*) filter (where c.confrelid = 'public.user_profiles'::regclass
                            and c.confdeltype = 'n')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.gift_recipients'::regclass
     and c.contype = 'f'
     and a.attname = 'person_id'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: gift_recipients.person_id has % foreign key(s) on it alone, % of them to user_profiles on delete set null; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  select count(*),
         count(*) filter (where c.confrelid = 'public.wishlist_items'::regclass
                            and c.confdeltype = 'n')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.tracked_gifts'::regclass
     and c.contype = 'f'
     and a.attname = 'wishlist_item_id'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: tracked_gifts.wishlist_item_id has % foreign key(s) on it alone, % of them to wishlist_items on delete set null; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  select count(*),
         count(*) filter (where c.confrelid = 'public.occasions'::regclass
                            and c.confdeltype = 'n')
    into v_count, v_count2
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid
   where c.conrelid = 'public.tracked_gifts'::regclass
     and c.contype = 'f'
     and a.attname = 'occasion_id'
     and c.conkey = array[a.attnum];

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'SCHEMA FAIL: tracked_gifts.occasion_id has % foreign key(s) on it alone, % of them to occasions on delete set null; expected exactly 1 of each',
      v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertions 8-9: the unique indexes, matched exactly (the form
  -- 21_anniversary_request_rules.sql uses). Drop UNIQUE, the predicate, or a
  -- column, or reorder the columns, and the text no longer matches.
  ---------------------------------------------------------------------------
  select indexdef into v_indexdef
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'gift_recipients'
     and indexname = 'gift_recipients_one_per_person';

  if v_indexdef is distinct from
     'CREATE UNIQUE INDEX gift_recipients_one_per_person ON public.gift_recipients USING btree (person_id, user_id) WHERE (person_id IS NOT NULL)' then
    raise exception
      'SCHEMA FAIL: gift_recipients_one_per_person is %, expected CREATE UNIQUE INDEX gift_recipients_one_per_person ON public.gift_recipients USING btree (person_id, user_id) WHERE (person_id IS NOT NULL)',
      v_indexdef;
  end if;
  v_checks := v_checks + 1;

  select indexdef into v_indexdef
    from pg_indexes
   where schemaname = 'public'
     and tablename = 'tracked_gifts'
     and indexname = 'tracked_gifts_one_per_item';

  if v_indexdef is distinct from
     'CREATE UNIQUE INDEX tracked_gifts_one_per_item ON public.tracked_gifts USING btree (wishlist_item_id, user_id) WHERE (wishlist_item_id IS NOT NULL)' then
    raise exception
      'SCHEMA FAIL: tracked_gifts_one_per_item is %, expected CREATE UNIQUE INDEX tracked_gifts_one_per_item ON public.tracked_gifts USING btree (wishlist_item_id, user_id) WHERE (wishlist_item_id IS NOT NULL)',
      v_indexdef;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: the giver can write the new columns through RLS. Read back
  -- as the connecting role, so the count is ground truth.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into gift_recipients (user_id, name, person_id)
    values (v_giver, 'Shoplink Owner', v_owner)
    returning id into v_recipient;

  insert into tracked_gifts (user_id, recipient_id, name, wishlist_item_id, from_list, occasion_id)
    values (v_giver, v_recipient, 'Shoplink Item One', v_item1, true, v_xmas)
    returning id into v_gift;

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from gift_recipients
   where id = v_recipient and user_id = v_giver and person_id = v_owner;

  select count(*) into v_count2
    from tracked_gifts
   where id = v_gift and user_id = v_giver and recipient_id = v_recipient
     and wishlist_item_id = v_item1 and from_list and occasion_id = v_xmas;

  if v_count <> 1 or v_count2 <> 1 then
    raise exception
      'RLS FAIL: the giver''s recipient % reads back as % row(s) and gift % as % row(s) with the new columns set, expected exactly 1 each',
      v_recipient, v_count, v_gift, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: the tracker stays private with the new columns. The owner
  -- cannot see a gift on their own item, nor a recipient that stands for
  -- them. Not vacuous: assertion 10 proved both rows exist.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from tracked_gifts where wishlist_item_id = v_item1;

  select count(*) into v_count2
    from gift_recipients where person_id = v_owner;

  perform set_config('role', v_orig_role, true);

  if v_count <> 0 or v_count2 <> 0 then
    raise exception
      'RLS FAIL: the item''s owner % sees % gift(s) on their own item % and % recipient(s) standing for them, expected 0 and 0 -- the tracker is private to the giver',
      v_owner, v_count, v_item1, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertions 12-13: set_claim_occasion is SECURITY DEFINER with its
  -- search_path pinned, executable by authenticated and not by anon.
  ---------------------------------------------------------------------------
  select p.prosecdef, p.proconfig into v_secdef, v_config
    from pg_proc p
   where p.oid = 'public.set_claim_occasion(uuid, uuid)'::regprocedure;

  if v_secdef is distinct from true
     or not coalesce('search_path=public' = any(v_config), false) then
    raise exception
      'GUARD FAIL: set_claim_occasion has prosecdef % and proconfig %, expected prosecdef true and search_path=public among proconfig',
      v_secdef, v_config;
  end if;
  v_checks := v_checks + 1;

  select has_function_privilege('authenticated', 'public.set_claim_occasion(uuid, uuid)', 'execute'),
         has_function_privilege('anon', 'public.set_claim_occasion(uuid, uuid)', 'execute')
    into v_can_authed, v_can_anon;

  if v_can_authed is distinct from true or v_can_anon is distinct from false then
    raise exception
      'GUARD FAIL: set_claim_occasion is executable by authenticated: %, by anon: %; expected true and false',
      v_can_authed, v_can_anon;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 14: the giver claims item one, then moves the claim to the
  -- group date -- admitted by the gate's group arm. And the move touches
  -- that claim alone: giver2's claim on item two still has no occasion.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  perform public.claim_wishlist_item(v_item1, null);
  perform public.set_claim_occasion(v_item1, v_xmas);

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from wishlist_claims
   where item_id = v_item1 and claimed_by = v_giver and released_at is null
     and occasion_id = v_xmas;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: after set_claim_occasion(%, %) the giver''s active claim on item % with that occasion resolves to % row(s), expected exactly 1 -- the group arm did not admit, or the update did not land',
      v_item1, v_xmas, v_item1, v_count;
  end if;

  -- Still the connecting role. Without the update's `where id = v_claim`
  -- the move would reach every claim, this one included.
  select count(*) into v_count2
    from wishlist_claims
   where item_id = v_item2 and claimed_by = v_giver2 and released_at is null
     and occasion_id is null;

  if v_count2 <> 1 then
    raise exception
      'RLS FAIL: after the giver''s set_claim_occasion(%, %), giver2''s active claim on item % with no occasion resolves to % row(s), expected exactly 1 -- someone else''s claim was moved',
      v_item1, v_xmas, v_item2, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 15: the giver materializes the celebrant's birthday and moves
  -- the claim to it -- admitted by the gate's celebrant arm.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  select public.get_or_create_celebrated_occasion(v_celeb, 'birthday') into v_bday;
  perform public.set_claim_occasion(v_item1, v_bday);

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from wishlist_claims
   where item_id = v_item1 and claimed_by = v_giver and released_at is null
     and occasion_id = v_bday;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: after set_claim_occasion(%, %) the giver''s active claim on item % with the celebrant''s birthday resolves to % row(s), expected exactly 1 -- the celebrant arm did not admit, or the update did not land',
      v_item1, v_bday, v_item1, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 16: the giver moves the claim to no occasion.
  ---------------------------------------------------------------------------
  perform set_config('role', 'authenticated', true);

  perform public.set_claim_occasion(v_item1, null);

  perform set_config('role', v_orig_role, true);

  select count(*) into v_count
    from wishlist_claims
   where item_id = v_item1 and claimed_by = v_giver and released_at is null
     and occasion_id is null;

  if v_count <> 1 then
    raise exception
      'RLS FAIL: after set_claim_occasion(%, null) the giver''s active claim on item % with no occasion resolves to % row(s), expected exactly 1',
      v_item1, v_item1, v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 17: not vacuous. Item two carries giver2's active claim, and
  -- the giver holds none there, so the function's own lookup, pinned to
  -- v_caller, is all that stands between the giver and moving giver2's
  -- claim. Assertion 20 anchors that line.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from wishlist_claims
   where item_id = v_item2 and claimed_by = v_giver2 and released_at is null;

  select count(*) into v_count2
    from wishlist_claims
   where item_id = v_item2 and claimed_by = v_giver;

  if v_count <> 1 or v_count2 <> 0 then
    raise exception
      'GUARD FAIL: item % has % active claim(s) by giver2 and % claim(s) by the giver, expected 1 and 0 -- the not-your-claim refusal would have nothing to refuse',
      v_item2, v_count, v_count2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 18: the floor beneath every anchored check on set_claim_
  -- occasion. A block comment leaves each line byte-identical, so the
  -- definition must contain no block-comment opener at all.
  ---------------------------------------------------------------------------
  select position('/*' in pg_get_functiondef(p.oid)) into v_block_comment_pos
    from pg_proc p
   where p.oid = 'public.set_claim_occasion(uuid, uuid)'::regprocedure;

  if v_block_comment_pos is distinct from 0 then
    raise exception
      'GUARD FAIL: set_claim_occasion''s definition contains a /* block comment starting at character % -- every anchored check in this file is unsound while this is true',
      v_block_comment_pos;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 19: the caller is the requesting user, and an anonymous call
  -- is refused with 28000.
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.set_claim_occasion(uuid, uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*v_caller text := \(select public\.requesting_user_id\(\)\);$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''not authenticated'' using errcode = ''28000'';$';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: set_claim_occasion no longer takes v_caller from requesting_user_id() and refuses an anonymous call with 28000, not line-commented (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 20: the lookup. The claim on this item, and the update of that
  -- claim alone; only the caller's own claim, not released, on an item the
  -- caller can still see, and not lapsed; otherwise 22023 "you no longer
  -- hold that item". The first two patterns are the lines whose removal
  -- would move the wrong claim, or every claim. The view line and the three
  -- lapse lines have no live check (a refusal ends the file), so this is all
  -- that guards them.
  ---------------------------------------------------------------------------
  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.set_claim_occasion(uuid, uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*where c\.item_id = p_item_id$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*where id = v_claim;$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and c\.claimed_by = v_caller$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and c\.released_at is null$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and public\.can_view_wishlist_item\(wi\.user_id, v_caller, wi\.privacy_settings\)$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and \(wi\.purchased$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*or c\.occasion_id is null$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*where o\.id = c\.occasion_id and o\.occasion_date < current_date$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''you no longer hold that item'' using errcode = ''22023'';$';

  if v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: set_claim_occasion''s lookup no longer pins the claim to this item and the caller, unreleased, on an item the caller can see and not lapsed, updates that claim alone, and keeps its 22023 refusal, not line-commented (matched % definition(s), expected 1)',
      v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 21: the occasion gate, claim_wishlist_item's three arms. The
  -- arms' `where o.id = p_occasion_id` lines are identical text, so they are
  -- counted (exactly 3, one per arm) rather than matched; the lapse
  -- subquery's `where o.id = c.occasion_id ...` does not match that pattern.
  ---------------------------------------------------------------------------
  select count(*) into v_occid_matches
    from pg_proc p,
         regexp_matches(
           pg_get_functiondef(p.oid),
           '(?n)^\s*where o\.id = p_occasion_id$',
           'g'
         ) m
   where p.oid = 'public.set_claim_occasion(uuid, uuid)'::regprocedure;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.set_claim_occasion(uuid, uuid)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and public\.can_view_field\(o\.celebrant_id, v_caller, pi\.privacy_settings\)$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and public\.can_view_field\(o\.partner_id, v_caller, pi\.privacy_settings\)$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*and public\.is_group_member\(o\.group_id, v_caller\)$'
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*raise exception ''that occasion is not available'' using errcode = ''22023'';$';

  if v_occid_matches <> 3 or v_guard_defs <> 1 then
    raise exception
      'GUARD FAIL: set_claim_occasion''s occasion gate has % `where o.id = p_occasion_id` line(s), expected 3 (one per arm), and matched its celebrant, partner and group arms with the 22023 refusal in % definition(s), expected 1',
      v_occid_matches, v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 22: D14, live. The row the giver materialized in assertion 15
  -- exists and records no creator. Ground truth, as the connecting role.
  ---------------------------------------------------------------------------
  select count(*), max(created_by) into v_count, v_created_by
    from public.occasions
   where id = v_bday and celebrant_id = v_celeb and kind = 'birthday';

  if v_count <> 1 or v_created_by is not null then
    raise exception
      'D14 FAIL: the celebrant''s birthday % (materialized by the giver) resolves to % row(s) with created_by=%, expected exactly 1 row with created_by null',
      v_bday, v_count, v_created_by;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 23: D14, live, as the celebrant. They can see the row with
  -- their own token, and it tells them nothing about who made it.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_celeb || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*), max(created_by) into v_count, v_created_by
    from public.occasions where id = v_bday;

  perform set_config('role', v_orig_role, true);

  if v_count <> 1 or v_created_by is not null then
    raise exception
      'D14 FAIL: as the celebrant, their birthday % reads as % row(s) with created_by=%, expected exactly 1 row with created_by null',
      v_bday, v_count, v_created_by;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 24: D14, source. The definition never names the creator
  -- column, and its insert names exactly four columns.
  ---------------------------------------------------------------------------
  select position('created_by' in pg_get_functiondef(p.oid)) into v_created_by_pos
    from pg_proc p
   where p.oid = 'public.get_or_create_celebrated_occasion(text, public.occasion_kind)'::regprocedure;

  select count(*) into v_guard_defs
    from pg_proc p
   where p.oid = 'public.get_or_create_celebrated_occasion(text, public.occasion_kind)'::regprocedure
     and pg_get_functiondef(p.oid) ~
       '(?n)^\s*insert into public\.occasions \(kind, celebrant_id, partner_id, occasion_date\)$';

  if v_created_by_pos is distinct from 0 or v_guard_defs <> 1 then
    raise exception
      'D14 FAIL: get_or_create_celebrated_occasion''s definition names created_by at character % (expected 0) and matched its four-column insert in % definition(s) (expected 1)',
      v_created_by_pos, v_guard_defs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 25: D14, data. No birthday row names a creator other than its
  -- celebrant. Birthdays only: this suite runs against real data, and an
  -- anniversary row can rightly name a former partner as its creator after
  -- a couple unlinks (unlink_anniversary clears partner_id and leaves the
  -- creator), which has nothing to do with D14.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from public.occasions
   where kind = 'birthday'
     and created_by is not null
     and created_by is distinct from celebrant_id;

  if v_count <> 0 then
    raise exception
      'D14 FAIL: % birthday row(s) record a creator other than the celebrant, expected 0 -- the clean-up in 20261111000000_shopping_links.sql did not run, or something still writes a giver onto a birthday',
      v_count;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 25 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 25', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_22_shopping_links');
end $$;

select token as result from _harness_result;
