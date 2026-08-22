-- Lazy profile provisioning must be safe to repeat, because it repeats.
--
-- ensureProfile() (lib/auth/ensure-profile.ts) runs on EVERY authenticated
-- request, through app/(dashboard)/layout.tsx. Three schema properties are
-- what make that safe, and none of them live in the TypeScript:
--
--   1. the primary key is `text`, so a Clerk id inserts as itself and needs no
--      mapping table;
--   2. `on conflict (id) do nothing ... returning` yields the row the FIRST
--      time and nothing afterwards -- that returned row is the one signal the
--      helper branches on to send the welcome email, so this is what makes the
--      email fire exactly once per user rather than once per request;
--   3. a repeat provision does not overwrite columns the user has since edited
--      in this app (username via setUsername, display_name via updateProfile).
--      Clerk does not know about those edits, so a `do update` here would
--      quietly reset a chosen username to a generated one on the next request.
--
-- Assertions 7-9 cover the OTHER way a user ends up with no row: Clerk allows
-- usernames this column rejects (65 characters, an `@` or a `.`), which raises
-- 23514 rather than the 23505 the collision retry handles. They pin the two
-- CHECK constraints that lib/auth/username.ts mirrors, and show that sanitised
-- forms of both hostile shapes provision.
--
-- Assertion 6 switches to `authenticated` because the row is WRITTEN by
-- the service-role admin client but READ BACK by the RLS-bound client in
-- getMyProfile(). A row the owner cannot select is a row that provisions the
-- user into a broken dashboard, and the write side alone cannot see that.
--
-- Naming: the brief called this file 05_profile_provisioning.sql, but 05 was
-- taken by 05_definer_pins.sql before this task started. 08 is the next free
-- index; the MANIFEST entry moves with it.

create temp table _harness_result (token text);

do $$
declare
  v_first_insert  int;
  v_second_insert int;
  v_rows          int;
  v_username      text;
  v_display       text;
  v_text_pk       int;
  v_owner_sees    int;
  v_len_def       text;
  v_fmt_def       text;
  v_raw_long      text;
  v_raw_weird     text;
  v_san_long      text;
  v_san_weird     text;
  v_hostile_rows  int;
  v_stored_long   text;
  v_stored_weird  text;
  v_orig_role     text;
  v_checks        int := 0;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- 1. First provision. A Clerk-shaped text id inserts, and the statement
  --    reports the row it created. This is the "new user" branch.
  ---------------------------------------------------------------------------
  with provisioned as (
    insert into user_profiles (id, username, display_name, email, avatar_url)
      values ('user_2abc123XYZ', 'clerkuser', 'Clerk User',
              'clerk@example.test', 'https://img.clerk.test/a.png')
      on conflict (id) do nothing
      returning id
  )
  select count(*) into v_first_insert from provisioned;

  if v_first_insert <> 1 then
    raise exception
      'PROVISIONING FAIL: the first insert reported % created row(s), expected 1. A Clerk-shaped text id must provision on first sight, and the returned row is what tells ensureProfile() this user is new.',
      v_first_insert;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  --    The user then edits the two columns this app owns rather than Clerk.
  ---------------------------------------------------------------------------
  update user_profiles
     set username = 'chosenname', display_name = 'Edited By User'
   where id = 'user_2abc123XYZ';

  ---------------------------------------------------------------------------
  -- 2. Second provision, same id, the values Clerk would hand us again. It
  --    must create nothing and report nothing, or every request would look
  --    like a signup and send another welcome email.
  ---------------------------------------------------------------------------
  with reprovisioned as (
    insert into user_profiles (id, username, display_name, email, avatar_url)
      values ('user_2abc123XYZ', 'clerkuser', 'Clerk User',
              'clerk@example.test', 'https://img.clerk.test/a.png')
      on conflict (id) do nothing
      returning id
  )
  select count(*) into v_second_insert from reprovisioned;

  if v_second_insert <> 0 then
    raise exception
      'PROVISIONING FAIL: re-provisioning an existing user reported % created row(s), expected 0. ensureProfile() reads that count as "this user is new" and would send a welcome email on every authenticated request.',
      v_second_insert;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 3. Idempotent: one user, one row.
  ---------------------------------------------------------------------------
  select count(*) into v_rows
    from user_profiles where id = 'user_2abc123XYZ';

  if v_rows <> 1 then
    raise exception
      'PROVISIONING FAIL: expected exactly 1 profile row for the Clerk id, got %.',
      v_rows;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 4. The user edits survived. This is the assertion that fails if anyone
  --    turns the insert into `do update`.
  ---------------------------------------------------------------------------
  select username, display_name into v_username, v_display
    from user_profiles where id = 'user_2abc123XYZ';

  if v_username is distinct from 'chosenname'
     or v_display is distinct from 'Edited By User' then
    raise exception
      'PROVISIONING FAIL: re-provisioning overwrote user-owned columns (username=%, display_name=%), expected chosenname / Edited By User. Clerk is not the source of truth for either, so a repeat provision must leave them alone.',
      v_username, v_display;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 5. The identity column itself: a single-column text primary key. A
  --    migration moving it back to uuid would make every Clerk id unstorable,
  --    and assertion 1 would then fail for a reason nobody could read.
  ---------------------------------------------------------------------------
  select count(*) into v_text_pk
    from pg_index i
   where i.indrelid = 'public.user_profiles'::regclass
     and i.indisprimary
     and i.indnkeyatts = 1
     and (select a.atttypid
            from pg_attribute a
           where a.attrelid = i.indrelid
             and a.attnum = i.indkey[0]) = 'text'::regtype;

  if v_text_pk <> 1 then
    raise exception
      'PROVISIONING FAIL: user_profiles does not have a single-column text primary key (matched % index/indexes, expected 1). Clerk ids are text like user_2abc123.',
      v_text_pk;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 6. The provisioned row is readable by its owner under RLS. Provisioning
  --    writes with the service-role key; the very next thing the dashboard
  --    does is read the profile back through the Clerk-authenticated client.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_2abc123XYZ","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_owner_sees
    from user_profiles where id = 'user_2abc123XYZ';

  if v_owner_sees <> 1 then
    raise exception
      'PROVISIONING FAIL: the owner sees % of their own freshly provisioned profile row(s), expected 1. The row exists but the dashboard could not read it back.',
      v_owner_sees;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- 7. The username column's two CHECK constraints, and the exact bounds they
  --    impose. lib/auth/username.ts mirrors these numbers and this character
  --    class in TypeScript; this assertion is what stops that mirror going
  --    stale silently. If a migration changes either bound, the sanitiser is
  --    wrong and the failure lands here rather than as a 23514 in production.
  ---------------------------------------------------------------------------
  select pg_get_constraintdef(oid) into v_len_def
    from pg_constraint
   where conrelid = 'public.user_profiles'::regclass and conname = 'username_length';

  select pg_get_constraintdef(oid) into v_fmt_def
    from pg_constraint
   where conrelid = 'public.user_profiles'::regclass and conname = 'username_format';

  if v_len_def is null or v_fmt_def is null
     or position('char_length(username) >= 3' in v_len_def) = 0
     or position('char_length(username) <= 30' in v_len_def) = 0
     or position('^[a-zA-Z0-9_-]+$' in v_fmt_def) = 0 then
    raise exception
      'PROVISIONING FAIL: the username constraints are missing or no longer say 3..30 / ^[a-zA-Z0-9_-]+$ (length=%, format=%). lib/auth/username.ts sanitises Clerk usernames to exactly those rules and is now wrong.',
      coalesce(v_len_def, 'MISSING'), coalesce(v_fmt_def, 'MISSING');
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 8. The hostile fixtures really are hostile. Clerk allows usernames up to
  --    64 characters and a wider alphabet than this column does, and such a
  --    username raises 23514 -- which is NOT the 23505 the collision retry in
  --    ensureProfile() handles. An unsanitised insert would leave the user
  --    with no row, forever: every later request repeats the same failure.
  ---------------------------------------------------------------------------
  v_raw_long  := 'task7' || repeat('x', 60);
  v_raw_weird := 'task7.probe+weird@example.com';

  if char_length(v_raw_long) <= 30 or v_raw_weird ~ '^[a-zA-Z0-9_-]+$' then
    raise exception
      'PROVISIONING FAIL: the fixtures are not actually rejected by the constraints asserted above (long=% chars, weird=%), so assertion 9 would prove nothing.',
      char_length(v_raw_long), v_raw_weird;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- 9. Sanitised, both provision. Same rules as lib/auth/username.ts: strip
  --    everything outside the permitted class, clamp to 30, and fall back to
  --    user_<last 8 of the id> if fewer than 3 characters survive (not
  --    exercised here -- both fixtures leave plenty). The runtime proof that
  --    the TypeScript performs this transformation is in the task report; what
  --    this asserts is that the RESULT of it is storable, which is the half
  --    that lives in the database.
  ---------------------------------------------------------------------------
  v_san_long  := left(regexp_replace(v_raw_long,  '[^a-zA-Z0-9_-]', '', 'g'), 30);
  v_san_weird := left(regexp_replace(v_raw_weird, '[^a-zA-Z0-9_-]', '', 'g'), 30);

  with hostile as (
    insert into user_profiles (id, username, display_name)
      values ('user_2hostileLONG',  v_san_long,  'Long Clerk Username'),
             ('user_2hostileWEIRD', v_san_weird, 'Weird Clerk Username')
      on conflict (id) do nothing
      returning id
  )
  select count(*) into v_hostile_rows from hostile;

  select username into v_stored_long
    from user_profiles where id = 'user_2hostileLONG';
  select username into v_stored_weird
    from user_profiles where id = 'user_2hostileWEIRD';

  if v_hostile_rows <> 2
     or v_stored_long is distinct from ('task7' || repeat('x', 25))
     or v_stored_weird is distinct from 'task7probeweirdexamplecom' then
    raise exception
      'PROVISIONING FAIL: sanitised Clerk usernames did not provision (% row(s) created, stored long=%, stored weird=%). A user whose Clerk username breaks the length or format constraint would be stranded with no profile row.',
      v_hostile_rows, coalesce(v_stored_long, 'NONE'), coalesce(v_stored_weird, 'NONE');
  end if;
  v_checks := v_checks + 1;

  if v_checks < 9 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 9. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_08_profile_provisioning');
end $$;

select token as result from _harness_result;
