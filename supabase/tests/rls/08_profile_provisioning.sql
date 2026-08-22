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
-- The last assertion switches to `authenticated` because the row is WRITTEN by
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

  if v_checks < 6 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 6. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_08_profile_provisioning');
end $$;

select token as result from _harness_result;
