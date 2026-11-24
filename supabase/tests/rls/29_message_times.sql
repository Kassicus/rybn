-- 20261124000000_message_times.sql: a message's time (messages.created_at) is
-- the database's own. The column is not null, and one trigger,
-- keep_message_time, sets it to the moment the row is written on insert
-- (clock_timestamp()) and keeps it on update, whatever the writer sends and
-- whoever writes. This file proves:
--
--   1. The column (assertions 1-2). messages.created_at is not null, and no
--      message in the table has a time later than the moment it is checked.
--   2. The trigger (assertions 3-4). messages has exactly one trigger running
--      keep_message_time(); it is named keep_message_time, fires before
--      insert or update, on every column, for each row, with no condition
--      (its definition compared whole, as 09_privacy_pins.sql compares
--      pin_group_type), and is enabled for ordinary writes. The function has
--      search_path pinned, and no API role (authenticated, anon,
--      service_role) may execute it.
--   3. A new message's time, sent from a member's own client (assertions
--      5-7). member, signed in, sends three messages to Mt Gift: one with a
--      time far later than now, one with a time far earlier, and one with its
--      time given as null. Each is stored with a time later than the start of
--      this file's statement (statement_timestamp(), which the fixtures
--      written before it put in the past) and no later than the moment it is
--      checked (clock_timestamp()): the moment the row was written, and not
--      the moment the statement or its transaction began.
--   4. A message's time is kept (assertions 8-9). After a pause, member
--      updates the first of them twice: its words together with a far later
--      time, then its time alone, to null. Each update changes one row. The
--      words change, and the time is the one the row was written with: not
--      the time sent, and not the moment of the update, which the pause puts
--      later.
--   5. Whoever writes (assertions 10-11). The website sends every message
--      as the service role, which row-level security does not apply to. The
--      connecting role, which it does not apply to either, carrying the
--      claims the service role carries (its role, and no sub), inserts a
--      message with a far later time, pauses, and updates that time to a far
--      earlier one. The message is stored with a time within the same
--      bounds, and the update changes one row and leaves that time as it
--      was.
--   6. The function's body (assertion 12). The deployed body of
--      keep_message_time(), its white space folded, is the one this file was
--      written against, whole: it reads nothing of who writes, so no role and
--      no claim is treated apart, the service role's among them. A body that
--      changes fails here until it is read.
--
-- RULES 2 AND 3 ARE RUN LIVE (assertions 5-11). Neither refuses a write, so
-- nothing here raises: each write goes through, and what is read back is the
-- time the database gave it. The column, the trigger, its grants and its
-- function's body are read from the catalog. That a message from before the
-- migration kept its time, unless it had none or a later one, is the
-- migration's own step and cannot be read back afterwards.
--
-- THE PAUSES are what tell a kept time from one set again. Every statement
-- of this file runs in one transaction, so now() never moves, and
-- clock_timestamp() does: a time set again at the update would be later
-- than the time the row was written with by at least the pause.
--
-- Convention: see 00_harness_smoke.sql. Fixtures are written as the
-- connecting (RLS-bypassing) role. member writes as a signed-in person's own
-- client does: request.jwt.claims and role are set around each write, and
-- `role` goes back to the captured current_user before every catalog read
-- and every read that verifies a write.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role  text;
  v_checks     int := 0;
  v_maker      text := 'user_mt_maker';
  v_member     text := 'user_mt_member';
  v_group      uuid;
  v_gift       uuid;
  v_later_id   uuid;
  v_id         uuid;
  v_later      timestamptz;
  v_time       timestamptz;
  v_time2      timestamptz;
  v_count      int;
  v_notnull    boolean;
  v_pinned     boolean;
  v_api_privs  boolean[];
  v_text       text;
  v_def        text;
  v_enabled    text;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Fixtures, all written as the connecting (RLS-bypassing) role.
  ---------------------------------------------------------------------------
  insert into user_profiles (id, username, display_name)
    values (v_maker,  'mtmaker',  'Mt Maker'),
           (v_member, 'mtmember', 'Mt Member');

  -- maker makes Mt Family, so add_group_creator_as_owner() makes maker its
  -- owner; member joins it.
  insert into groups (name, type, invite_code, created_by)
    values ('Mt Family', 'family', 'MTMFAM01', v_maker)
    returning id into v_group;

  insert into group_members (group_id, user_id, role)
    values (v_group, v_member, 'member');

  -- Mt Gift, made by maker, with member rows for maker and member. Nobody is
  -- named on it.
  insert into group_gifts (group_id, name, created_by)
    values (v_group, 'Mt Gift', v_maker)
    returning id into v_gift;

  insert into group_gift_members (group_gift_id, user_id)
    values (v_gift, v_maker),
           (v_gift, v_member);

  ---------------------------------------------------------------------------
  -- Assertion 1: messages.created_at is not null.
  ---------------------------------------------------------------------------
  select a.attnotnull into v_notnull
    from pg_attribute a
   where a.attrelid = 'public.messages'::regclass
     and a.attname = 'created_at'
     and not a.attisdropped;

  if v_notnull is distinct from true then
    raise exception
      'SCHEMA FAIL: messages.created_at has attnotnull %; expected true',
      v_notnull;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: no message has a time later than now. Read as the
  -- connecting role, which sees every row of the table.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from messages m
   where m.created_at > clock_timestamp();

  if v_count <> 0 then
    raise exception
      'TIME FAIL: % message(s) have a time later than now; expected 0',
      v_count;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: messages has exactly one non-internal trigger running
  -- keep_message_time(). It is named keep_message_time, and it is BEFORE
  -- INSERT OR UPDATE, on every column, FOR EACH ROW, with no WHEN condition
  -- (compared whole), and enabled for ordinary writes. Enabled state is not
  -- part of pg_get_triggerdef, so it is read beside it.
  ---------------------------------------------------------------------------
  select count(*) into v_count
    from pg_trigger tg
   where tg.tgrelid = 'public.messages'::regclass
     and tg.tgfoid = 'public.keep_message_time()'::regprocedure
     and not tg.tgisinternal;

  select replace(pg_get_triggerdef(t.oid), 'FUNCTION public.', 'FUNCTION '),
         t.tgenabled::text
    into v_def, v_enabled
    from pg_trigger t
   where t.tgrelid = 'public.messages'::regclass
     and t.tgname = 'keep_message_time'
     and not t.tgisinternal;

  if v_count <> 1
     or v_def is distinct from
        'CREATE TRIGGER keep_message_time BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION keep_message_time()'
     or v_enabled is distinct from 'O' then
    raise exception
      'GUARD FAIL: messages has % trigger(s) running keep_message_time, and the one named keep_message_time reads % with tgenabled %; expected 1, then CREATE TRIGGER keep_message_time BEFORE INSERT OR UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION keep_message_time(), enabled (O)',
      v_count, coalesce(v_def, '<no such trigger>'), coalesce(v_enabled, '<no such trigger>');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 4: keep_message_time() has search_path pinned, and no API role
  -- (authenticated, anon, service_role) may execute it.
  ---------------------------------------------------------------------------
  select coalesce('search_path=public' = any(p.proconfig), false),
         array[has_function_privilege('authenticated', p.oid, 'execute'),
               has_function_privilege('anon', p.oid, 'execute'),
               has_function_privilege('service_role', p.oid, 'execute')]
    into v_pinned, v_api_privs
    from pg_proc p
   where p.oid = 'public.keep_message_time()'::regprocedure;

  if v_pinned is distinct from true or true = any(v_api_privs) then
    raise exception
      'GUARD FAIL: keep_message_time has search_path=public: %; execute held by authenticated, anon and service_role: %; expected true and all false',
      v_pinned, v_api_privs;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5: a message sent with a time far later than now is stored
  -- with the moment it was written. member sends it, signed in.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_mt_member","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into messages (group_gift_id, user_id, content, created_at)
    values (v_gift, v_member, 'Mt later', '2099-01-01T00:00:00Z')
    returning id, created_at into v_later_id, v_later;

  perform set_config('role', v_orig_role, true);

  if v_later_id is null or v_later is null
     or v_later <= statement_timestamp() or v_later > clock_timestamp() then
    raise exception
      'TIME FAIL: a message member sent with the time 2099-01-01 was stored with %; expected a time later than % (the start of this statement) and no later than % (now)',
      v_later, statement_timestamp(), clock_timestamp();
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 6: a message sent with a time far earlier than now is stored
  -- with the moment it was written.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_mt_member","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into messages (group_gift_id, user_id, content, created_at)
    values (v_gift, v_member, 'Mt earlier', '2001-01-01T00:00:00Z')
    returning id, created_at into v_id, v_time;

  perform set_config('role', v_orig_role, true);

  if v_id is null or v_time is null
     or v_time <= statement_timestamp() or v_time > clock_timestamp() then
    raise exception
      'TIME FAIL: a message member sent with the time 2001-01-01 was stored with %; expected a time later than % (the start of this statement) and no later than % (now)',
      v_time, statement_timestamp(), clock_timestamp();
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 7: a message sent with its time given as null is stored with
  -- the moment it was written.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_mt_member","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  insert into messages (group_gift_id, user_id, content, created_at)
    values (v_gift, v_member, 'Mt no time', null)
    returning id, created_at into v_id, v_time;

  perform set_config('role', v_orig_role, true);

  if v_id is null or v_time is null
     or v_time <= statement_timestamp() or v_time > clock_timestamp() then
    raise exception
      'TIME FAIL: a message member sent with its time given as null was stored with %; expected a time later than % (the start of this statement) and no later than % (now)',
      v_time, statement_timestamp(), clock_timestamp();
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 8: an update that sends new words and a far later time changes
  -- the words and keeps the time. After a pause, member updates the message
  -- of assertion 5; one row changes, its words are the new ones, and its
  -- time is the one it was written with.
  ---------------------------------------------------------------------------
  perform pg_sleep(0.05);

  perform set_config('request.jwt.claims',
    '{"sub":"user_mt_member","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update messages
     set content = 'Mt edited',
         created_at = '2099-01-01T00:00:00Z'
   where id = v_later_id;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select m.content, m.created_at into v_text, v_time
    from messages m
   where m.id = v_later_id;

  if v_count <> 1 or v_text is distinct from 'Mt edited'
     or v_time is distinct from v_later then
    raise exception
      'TIME FAIL: member''s update of their message''s words and time changed % row(s), and the message now reads % with the time %; expected 1, Mt edited and %, the time it was written with',
      v_count, v_text, v_time, v_later;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 9: an update that sends the time as null keeps the time.
  -- member updates the same message; one row changes, and its time is the
  -- one it was written with.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_mt_member","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  update messages
     set created_at = null
   where id = v_later_id;
  get diagnostics v_count = row_count;

  perform set_config('role', v_orig_role, true);

  select m.created_at into v_time
    from messages m
   where m.id = v_later_id;

  if v_count <> 1 or v_time is distinct from v_later then
    raise exception
      'TIME FAIL: member''s update of their message''s time to null changed % row(s), and the message now has the time %; expected 1 and %, the time it was written with',
      v_count, v_time, v_later;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 10: the rule holds for a writer row-level security does not
  -- apply to, carrying the service role's claims: its role, and no sub. The
  -- connecting role inserts a message with a far later time, and it is
  -- stored with the moment it was written.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);

  insert into messages (group_gift_id, user_id, content, created_at)
    values (v_gift, v_maker, 'Mt from the connecting role', '2099-01-01T00:00:00Z')
    returning id, created_at into v_id, v_time;

  if v_id is null or v_time is null
     or v_time <= statement_timestamp() or v_time > clock_timestamp() then
    raise exception
      'TIME FAIL: a message the connecting role wrote with the time 2099-01-01 was stored with %; expected a time later than % (the start of this statement) and no later than % (now)',
      v_time, statement_timestamp(), clock_timestamp();
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 11: and so does the keeping. After a pause, the connecting
  -- role, with the same claims, updates that message's time to a far earlier
  -- one; one row changes, and its time is the one it was written with.
  ---------------------------------------------------------------------------
  perform pg_sleep(0.05);

  update messages
     set created_at = '2001-01-01T00:00:00Z'
   where id = v_id;
  get diagnostics v_count = row_count;

  select m.created_at into v_time2
    from messages m
   where m.id = v_id;

  if v_count <> 1 or v_time2 is distinct from v_time then
    raise exception
      'TIME FAIL: the connecting role''s update of its message''s time changed % row(s), and the message now has the time %; expected 1 and %, the time it was written with',
      v_count, v_time2, v_time;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 12: the deployed body of keep_message_time(), every run of
  -- white space folded to one space, is this one, whole. It reads nothing of
  -- who writes, so the rule cannot be set aside for one role or one claim.
  -- Last, so a body whose rule is broken fails at the write that shows it.
  ---------------------------------------------------------------------------
  select btrim(regexp_replace(p.prosrc, '\s+', ' ', 'g')) into v_text
    from pg_proc p
   where p.oid = 'public.keep_message_time()'::regprocedure;

  if v_text is distinct from
     'begin if tg_op = ''INSERT'' then new.created_at := clock_timestamp(); else new.created_at := old.created_at; end if; return new; end;' then
    raise exception
      'GUARD FAIL: the body of keep_message_time reads: %; expected: begin if tg_op = ''INSERT'' then new.created_at := clock_timestamp(); else new.created_at := old.created_at; end if; return new; end;',
      v_text;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 12 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 12', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_29_message_times');
end $$;

select token as result from _harness_result;
