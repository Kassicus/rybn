-- 20261115000001_private_columns.sql: the columns a signed-in person's client
-- (the role authenticated) can select on user_profiles and wishlist_items,
-- and update_wishlist_items_updated_at, which sets an item's updated_at to
-- now() only when an update writes one of the item's own nine columns, or
-- updated_at itself. This file proves:
--
--   1. The privileges (assertions 1-5). authenticated holds no table-level
--      SELECT on user_profiles; of its columns it can select exactly id,
--      username, display_name, avatar_url, bio, created_at and updated_at,
--      and cannot select exactly email and email_preferences. It holds no
--      table-level SELECT on wishlist_items either; of its columns it can
--      select exactly id, user_id, title, description, details, url, price,
--      image_url, priority, category, privacy_settings, created_at and
--      updated_at, and cannot select exactly purchased, purchased_at,
--      out_of_stock_marked_by and out_of_stock_marked_at. Each list is
--      compared whole, in name order, so a column added to either table
--      without a grant fails here by name. authenticated still holds INSERT, UPDATE and DELETE on both
--      tables; anon can select no column of either; service_role holds
--      table-level SELECT on both.
--   2. The trigger (assertion 6). update_wishlist_items_updated_at, compared
--      whole as Postgres prints it, fires before an update of any of ten
--      names, the item's own nine columns (title, description, url, price,
--      image_url, priority, category, privacy_settings, details) and
--      updated_at itself, for each row, and runs update_updated_at_column();
--      and it is enabled.
--   3. When updated_at moves, live (assertions 7-11). owner's five items A,
--      B, C, D and E each have updated_at a day ago, written by the fixture.
--      giver, who shares a family group with owner, marks A bought and B out
--      of stock (B by the statement the site sends, asking back only id): one
--      row each, and each item's updated_at is still the fixture's. owner
--      renames C: its updated_at is now. The connecting role deletes marker's
--      profile: D, which marker had marked out of stock, is no longer marked,
--      and its updated_at is as it was before the delete. giver sets E's
--      updated_at to a year ago: one row, and E's updated_at is now, neither
--      the value written nor the fixture's.
--   4. Named columns, live (assertion 12). owner counts their own five items
--      and reads C by its thirteen selectable columns; giver reads owner's
--      profile by its seven, and owner's username.
--   5. The two functions, live (assertion 13). Asked about A, B, C and D,
--      visible_item_marks answers giver A (bought, no marker) and B (not
--      bought, marked by giver) and nothing else, and answers owner nothing;
--      own_contact answers owner their own email and email_preferences.
--   6. A write to a column authenticated cannot select, live (assertion 14).
--      owner sets their own email_preferences, asking nothing back: one row,
--      and own_contact then answers the new value.
--
-- REFUSALS THAT RAISE ARE NOT ATTEMPTED LIVE. A select by authenticated of
-- email, email_preferences or a mark, or of a whole row of either table,
-- raises, and one uncaught raise ends the whole batch this file is sent as;
-- the runner bans handlers file-wide. Assertions 1-3 hold those refusals at
-- the privilege layer. Every statement run as authenticated here names only
-- columns it can select: each write's row count is read from the write
-- itself, assertion 8's write asks back only id, the marks and updated_at are
-- read back as the connecting role, and email_preferences through
-- own_contact().
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. Each impersonated read, write or call
-- sets request.jwt.claims and role around it, and `role` goes back to the
-- captured current_user before every catalog read and every read that
-- verifies a write. now() is one value for the whole transaction, so the
-- fixture writes each item's updated_at as a day before it, and assertion 11
-- writes a year before it.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role        text;
  v_checks           int := 0;
  v_owner            text := 'user_pcol_owner';
  v_giver            text := 'user_pcol_giver';
  v_marker           text := 'user_pcol_marker';
  v_owner_email      text := 'pcol.owner@example.test';
  v_owner_prefs      jsonb := '{"email_group_invites": false, "email_date_reminders": true, "email_gift_updates": true, "email_exchange_notifications": false, "email_marketing": false}';
  v_new_prefs        jsonb := '{"email_group_invites": true, "email_date_reminders": false, "email_gift_updates": false, "email_exchange_notifications": true, "email_marketing": true}';
  v_family_only      jsonb := '{"visibleToGroupTypes": ["family"], "restrictToGroup": null}';
  v_day_ago          timestamptz := now() - interval '1 day';
  v_year_ago         timestamptz := now() - interval '1 year';
  v_group            uuid;
  v_a                uuid;
  v_b                uuid;
  v_c                uuid;
  v_d                uuid;
  v_e                uuid;
  v_item             uuid;
  v_ids              uuid[];
  v_table_select     boolean;
  v_selectable       text;
  v_unselectable     text;
  v_ins_profiles     boolean;
  v_upd_profiles     boolean;
  v_del_profiles     boolean;
  v_ins_items        boolean;
  v_upd_items        boolean;
  v_del_items        boolean;
  v_anon_profiles    boolean;
  v_anon_items       boolean;
  v_service_profiles boolean;
  v_service_items    boolean;
  v_def              text;
  v_enabled          text;
  v_count            int;
  v_count2           int;
  v_count3           int;
  v_count4           int;
  v_count5           int;
  v_bought           boolean;
  v_marked_by        text;
  v_marked_by2       text;
  v_updated          timestamptz;
  v_updated2         timestamptz;
  v_title            text;
  v_username         text;
  v_email            text;
  v_prefs            jsonb;
  v_answer           text;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  -- owner's email_preferences are not the column's default, so assertion 13
  -- reads back what this file wrote, and every key of the value assertion 14
  -- writes differs from it. marker is in no group and nothing in
  -- this file refers to marker but D's out_of_stock_marked_by, so deleting
  -- marker's profile (assertion 10) touches only that.
  insert into user_profiles (id, username, display_name, email, email_preferences)
    values (v_owner, 'pcolowner', 'Pcol Owner', v_owner_email, v_owner_prefs);

  insert into user_profiles (id, username, display_name, email)
    values (v_giver,  'pcolgiver',  'Pcol Giver',  'pcol.giver@example.test'),
           (v_marker, 'pcolmarker', 'Pcol Marker', 'pcol.marker@example.test');

  -- add_group_creator_as_owner() adds owner. giver joins, so owner and giver
  -- share a family group, and giver sees owner's family-only items.
  insert into groups (name, type, invite_code, created_by)
    values ('Pcol Family', 'family', 'PCOLFAM1', v_owner)
    returning id into v_group;

  insert into group_members (group_id, user_id, role)
    values (v_group, v_giver, 'member')
    on conflict do nothing;

  -- owner's A (to be bought), B (to be marked out of stock), C (to be
  -- renamed), D (marked out of stock by marker a day ago) and E (whose
  -- updated_at giver writes in assertion 11), each seen by the family group,
  -- each with updated_at a day ago.
  insert into wishlist_items (user_id, title, privacy_settings, purchased, updated_at)
    values (v_owner, 'Pcol Bought', v_family_only, false, v_day_ago)
    returning id into v_a;

  insert into wishlist_items (user_id, title, privacy_settings, purchased, updated_at)
    values (v_owner, 'Pcol Stock', v_family_only, false, v_day_ago)
    returning id into v_b;

  insert into wishlist_items (user_id, title, privacy_settings, purchased, updated_at)
    values (v_owner, 'Pcol Edit', v_family_only, false, v_day_ago)
    returning id into v_c;

  insert into wishlist_items (user_id, title, privacy_settings, purchased,
                              out_of_stock_marked_by, out_of_stock_marked_at, updated_at)
    values (v_owner, 'Pcol Marked', v_family_only, false, v_marker, v_day_ago, v_day_ago)
    returning id into v_d;

  insert into wishlist_items (user_id, title, privacy_settings, purchased, updated_at)
    values (v_owner, 'Pcol Stamped', v_family_only, false, v_day_ago)
    returning id into v_e;

  v_ids := array[v_a, v_b, v_c, v_d];

  ---------------------------------------------------------------------------
  -- Assertion 1: authenticated holds no table-level SELECT on user_profiles.
  ---------------------------------------------------------------------------
  select has_table_privilege('authenticated', 'public.user_profiles', 'SELECT')
    into v_table_select;

  if v_table_select is distinct from false then
    raise exception
      'COLUMNS FAIL: authenticated holds table-level SELECT on user_profiles: %; expected false, so that it selects only the columns granted to it',
      v_table_select;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: of user_profiles' columns (not dropped, attnum > 0),
  -- authenticated can select exactly the seven, and cannot select exactly
  -- email and email_preferences. Each list in name order, compared whole.
  ---------------------------------------------------------------------------
  select coalesce(string_agg(a.attname::text, ', ' order by a.attname::text collate "C")
                    filter (where has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')),
                  '<none>'),
         coalesce(string_agg(a.attname::text, ', ' order by a.attname::text collate "C")
                    filter (where not has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')),
                  '<none>')
    into v_selectable, v_unselectable
    from pg_attribute a
   where a.attrelid = 'public.user_profiles'::regclass
     and a.attnum > 0
     and not a.attisdropped;

  if v_selectable is distinct from 'avatar_url, bio, created_at, display_name, id, updated_at, username'
     or v_unselectable is distinct from 'email, email_preferences' then
    raise exception
      'COLUMNS FAIL: of user_profiles, authenticated can select % and cannot select %; expected exactly avatar_url, bio, created_at, display_name, id, updated_at, username and exactly email, email_preferences',
      v_selectable, v_unselectable;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: authenticated holds no table-level SELECT on
  -- wishlist_items; of its columns (not dropped, attnum > 0) it can select
  -- exactly the thirteen, and cannot select exactly the four marks. Each list
  -- in name order, compared whole.
  ---------------------------------------------------------------------------
  select has_table_privilege('authenticated', 'public.wishlist_items', 'SELECT')
    into v_table_select;

  select coalesce(string_agg(a.attname::text, ', ' order by a.attname::text collate "C")
                    filter (where has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')),
                  '<none>'),
         coalesce(string_agg(a.attname::text, ', ' order by a.attname::text collate "C")
                    filter (where not has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')),
                  '<none>')
    into v_selectable, v_unselectable
    from pg_attribute a
   where a.attrelid = 'public.wishlist_items'::regclass
     and a.attnum > 0
     and not a.attisdropped;

  if v_table_select is distinct from false
     or v_selectable is distinct from 'category, created_at, description, details, id, image_url, price, priority, privacy_settings, title, updated_at, url, user_id'
     or v_unselectable is distinct from 'out_of_stock_marked_at, out_of_stock_marked_by, purchased, purchased_at' then
    raise exception
      'COLUMNS FAIL: authenticated holds table-level SELECT on wishlist_items: % (expected false); of its columns it can select % and cannot select %; expected exactly category, created_at, description, details, id, image_url, price, priority, privacy_settings, title, updated_at, url, user_id and exactly out_of_stock_marked_at, out_of_stock_marked_by, purchased, purchased_at',
      v_table_select, v_selectable, v_unselectable;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: authenticated still holds INSERT, UPDATE and DELETE on both
  -- tables.
  ---------------------------------------------------------------------------
  select has_table_privilege('authenticated', 'public.user_profiles', 'INSERT'),
         has_table_privilege('authenticated', 'public.user_profiles', 'UPDATE'),
         has_table_privilege('authenticated', 'public.user_profiles', 'DELETE'),
         has_table_privilege('authenticated', 'public.wishlist_items', 'INSERT'),
         has_table_privilege('authenticated', 'public.wishlist_items', 'UPDATE'),
         has_table_privilege('authenticated', 'public.wishlist_items', 'DELETE')
    into v_ins_profiles, v_upd_profiles, v_del_profiles,
         v_ins_items, v_upd_items, v_del_items;

  if v_ins_profiles is distinct from true or v_upd_profiles is distinct from true
     or v_del_profiles is distinct from true or v_ins_items is distinct from true
     or v_upd_items is distinct from true or v_del_items is distinct from true then
    raise exception
      'COLUMNS FAIL: authenticated holds INSERT %, UPDATE % and DELETE % on user_profiles, and INSERT %, UPDATE % and DELETE % on wishlist_items; expected true for all six',
      v_ins_profiles, v_upd_profiles, v_del_profiles, v_ins_items, v_upd_items, v_del_items;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: anon can select no column of either table (neither at the
  -- table level nor on any column), and service_role holds table-level
  -- SELECT on both.
  ---------------------------------------------------------------------------
  select has_any_column_privilege('anon', 'public.user_profiles', 'SELECT'),
         has_any_column_privilege('anon', 'public.wishlist_items', 'SELECT'),
         has_table_privilege('service_role', 'public.user_profiles', 'SELECT'),
         has_table_privilege('service_role', 'public.wishlist_items', 'SELECT')
    into v_anon_profiles, v_anon_items, v_service_profiles, v_service_items;

  if v_anon_profiles is distinct from false or v_anon_items is distinct from false
     or v_service_profiles is distinct from true or v_service_items is distinct from true then
    raise exception
      'COLUMNS FAIL: anon can select a column of user_profiles: % and of wishlist_items: %; service_role holds table-level SELECT on user_profiles: % and on wishlist_items: %; expected false, false, true and true',
      v_anon_profiles, v_anon_items, v_service_profiles, v_service_items;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: update_wishlist_items_updated_at is exactly the trigger
  -- Postgres prints for a BEFORE UPDATE OF ten names, the item's own nine
  -- columns and updated_at itself, FOR EACH ROW, running
  -- update_updated_at_column() (compared whole, as 09_privacy_pins.sql
  -- compares pin_wishlist_item_owner_fields), and it is enabled for
  -- ordinary writes. Enabled state is not part of pg_get_triggerdef, so it
  -- is read beside it.
  ---------------------------------------------------------------------------
  select replace(pg_get_triggerdef(t.oid), 'FUNCTION public.', 'FUNCTION '),
         t.tgenabled::text
    into v_def, v_enabled
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'wishlist_items'
     and t.tgname = 'update_wishlist_items_updated_at'
     and not t.tgisinternal;

  if v_def is distinct from
     'CREATE TRIGGER update_wishlist_items_updated_at BEFORE UPDATE OF title, description, url, price, image_url, priority, category, privacy_settings, updated_at, details ON public.wishlist_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()'
     or v_enabled is distinct from 'O' then
    raise exception
      'TRIGGER FAIL: update_wishlist_items_updated_at reads % with tgenabled %; expected CREATE TRIGGER update_wishlist_items_updated_at BEFORE UPDATE OF title, description, url, price, image_url, priority, category, privacy_settings, updated_at, details ON public.wishlist_items FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(), enabled (O)',
      coalesce(v_def, '<no such trigger>'), coalesce(v_enabled, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: giver marks A bought, as markAsPurchased() does: one row
  -- changes. Read back as the connecting role, A is bought and its
  -- updated_at is still the fixture's.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update wishlist_items
     set purchased = true, purchased_at = now()
   where id = v_a;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select w.purchased, w.updated_at
    into v_bought, v_updated
    from wishlist_items w
   where w.id = v_a;

  if v_count <> 1 or v_bought is distinct from true
     or v_updated is distinct from v_day_ago then
    raise exception
      'TRIGGER FAIL: % marking A (%) bought changed % row(s), and A then reads purchased % with updated_at %; expected 1 row, true, and updated_at as the fixture wrote it (%)',
      v_giver, v_a, v_count, v_bought, v_updated, v_day_ago;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: giver marks B out of stock in their own name, by the
  -- statement markOutOfStock() sends: not on an item of their own, asking
  -- back only id. One row changes and the id it answers is B's. Read back
  -- as the connecting role, B is marked by giver and its updated_at is
  -- still the fixture's.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update wishlist_items
     set out_of_stock_marked_by = v_giver, out_of_stock_marked_at = now()
   where id = v_b
     and user_id <> v_giver
  returning id into v_item;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select w.out_of_stock_marked_by, w.updated_at
    into v_marked_by, v_updated
    from wishlist_items w
   where w.id = v_b;

  if v_count <> 1 or v_item is distinct from v_b
     or v_marked_by is distinct from v_giver
     or v_updated is distinct from v_day_ago then
    raise exception
      'TRIGGER FAIL: % marking B (%) out of stock changed % row(s) and answered id %, and B then reads out_of_stock_marked_by % with updated_at %; expected 1 row answering B''s id, %, and updated_at as the fixture wrote it (%)',
      v_giver, v_b, v_count, v_item, v_marked_by, v_updated, v_giver, v_day_ago;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: owner renames C, and the update names no updated_at: one
  -- row changes. Read back as the connecting role, C has its new title and
  -- its updated_at is now, off the fixture's.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update wishlist_items
     set title = 'Pcol Edited'
   where id = v_c;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select w.title, w.updated_at
    into v_title, v_updated
    from wishlist_items w
   where w.id = v_c;

  if v_count <> 1 or v_title is distinct from 'Pcol Edited'
     or v_updated is distinct from now() then
    raise exception
      'TRIGGER FAIL: % renaming C (%) changed % row(s), and C then reads title % with updated_at %; expected 1 row, Pcol Edited, and updated_at now (%), not the fixture''s (%)',
      v_owner, v_c, v_count, v_title, v_updated, now(), v_day_ago;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: as the connecting role, D is marked out of stock by
  -- marker. Deleting marker's profile deletes one row; the foreign key's on
  -- delete set null then clears D's out_of_stock_marked_by, and D's
  -- updated_at is as it was before the delete.
  ---------------------------------------------------------------------------
  select w.out_of_stock_marked_by, w.updated_at
    into v_marked_by, v_updated
    from wishlist_items w
   where w.id = v_d;

  delete from user_profiles
   where id = v_marker;
  get diagnostics v_count = row_count;

  select w.out_of_stock_marked_by, w.updated_at
    into v_marked_by2, v_updated2
    from wishlist_items w
   where w.id = v_d;

  if v_marked_by is distinct from v_marker or v_updated is distinct from v_day_ago
     or v_count <> 1 or v_marked_by2 is not null
     or v_updated2 is distinct from v_updated then
    raise exception
      'TRIGGER FAIL: before the delete D (%) is marked by % with updated_at % (expected % and %); deleting %''s profile deleted % row(s), and D then reads out_of_stock_marked_by % with updated_at %; expected 1 row, null, and updated_at as it was before the delete',
      v_d, v_marked_by, v_updated, v_marker, v_day_ago, v_marker, v_count, v_marked_by2, v_updated2;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: giver writes E's updated_at, and nothing else, setting it
  -- to a year ago: one row changes. updated_at is on the trigger's list, so
  -- read back as the connecting role E's updated_at is now: neither the
  -- value written nor the fixture's. No other assertion reads E's
  -- updated_at, so assertions 7, 8 and 10 are untouched by this write.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update wishlist_items
     set updated_at = v_year_ago
   where id = v_e;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select w.updated_at
    into v_updated
    from wishlist_items w
   where w.id = v_e;

  if v_count <> 1 or v_updated is not distinct from v_year_ago
     or v_updated is not distinct from v_day_ago
     or v_updated is distinct from now() then
    raise exception
      'TRIGGER FAIL: % setting E''s (%) updated_at to % changed % row(s), and E then reads updated_at %; expected 1 row, and updated_at now (%), neither the value written nor the fixture''s (%)',
      v_giver, v_e, v_year_ago, v_count, v_updated, now(), v_day_ago;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12: reads that name their columns work. owner counts their
  -- own five items with count(*) and reads C by the thirteen columns
  -- authenticated can select; giver, who shares a family group with owner,
  -- reads owner's profile by its seven, and owner's username.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_count
    from wishlist_items w
   where w.user_id = v_owner;

  select count(*) into v_count2
    from (select w.id, w.user_id, w.title, w.description, w.url, w.price, w.image_url,
                 w.priority, w.category, w.privacy_settings, w.created_at, w.updated_at, w.details
            from wishlist_items w
           where w.id = v_c
             and w.title = 'Pcol Edited') s;

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_giver || '","role":"authenticated"}', true);

  select count(*) into v_count3
    from (select p.id, p.username, p.display_name, p.avatar_url, p.bio,
                 p.created_at, p.updated_at
            from user_profiles p
           where p.id = v_owner) s;

  select p.username into v_username
    from user_profiles p
   where p.id = v_owner;

  perform set_config('role', v_orig_role, true);

  if v_count <> 5 or v_count2 <> 1 or v_count3 <> 1
     or v_username is distinct from 'pcolowner' then
    raise exception
      'READ FAIL: % counts % of their own items (expected 5) and reads C by its thirteen columns in % row(s) (expected 1); % reads %''s profile by its seven columns in % row(s) (expected 1), with username % (expected pcolowner)',
      v_owner, v_count, v_count2, v_giver, v_owner, v_count3, v_username;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 13: the column privileges leave the two functions' answers as
  -- they are, since each runs as its owner. Asked about A, B, C and D,
  -- visible_item_marks answers giver exactly A (bought, no marker) and B
  -- (not bought, marked by giver); nothing about C (no mark) or D (no mark
  -- since assertion 10). It answers owner nothing about their own four.
  -- own_contact answers owner exactly one row, their own email and
  -- email_preferences.
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

  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);

  select count(*) into v_count4
    from public.visible_item_marks(v_ids) m;

  select count(*), max(c.email), max(c.email_preferences::text)::jsonb
    into v_count5, v_email, v_prefs
    from public.own_contact() c;

  perform set_config('role', v_orig_role, true);

  if v_count <> 2 or v_count2 <> 1 or v_count3 <> 1 or v_count4 <> 0
     or v_count5 <> 1 or v_email is distinct from v_owner_email
     or v_prefs is distinct from v_owner_prefs then
    raise exception
      'MARKS FAIL: visible_item_marks as %, asked about A, B, C and D, answers % row(s) (%); expected exactly 2: A (%) bought with no marker, and B (%) not bought, marked by %. As % it answers % row(s), expected 0. own_contact as % answers % row(s) reading % and %; expected exactly 1 reading % and %',
      v_giver, v_count, coalesce(v_answer, 'none'), v_a, v_b, v_giver,
      v_owner, v_count4, v_owner, v_count5, v_email, v_prefs, v_owner_email, v_owner_prefs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 14: owner sets their own email_preferences, asking nothing
  -- back: the one write the site makes to a column its signed-in client
  -- cannot select. One row changes. own_contact then answers owner exactly
  -- one row, their own email and the new email_preferences.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_owner || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update user_profiles
     set email_preferences = v_new_prefs
   where id = v_owner;
  get diagnostics v_count = row_count;

  select count(*), max(c.email), max(c.email_preferences::text)::jsonb
    into v_count2, v_email, v_prefs
    from public.own_contact() c;

  perform set_config('role', v_orig_role, true);

  if v_count <> 1 or v_count2 <> 1 or v_email is distinct from v_owner_email
     or v_prefs is distinct from v_new_prefs then
    raise exception
      'CONTACT FAIL: % setting their own email_preferences changed % row(s), and own_contact then answers % row(s) reading % and %; expected 1 row, and exactly 1 row reading % and %',
      v_owner, v_count, v_count2, v_email, v_prefs, v_owner_email, v_new_prefs;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 14 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 14', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_27_private_columns');
end $$;

select token as result from _harness_result;
