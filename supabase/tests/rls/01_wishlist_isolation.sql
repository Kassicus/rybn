-- A user must never read another user's private wishlist items.
--
-- This is the spec's headline guarantee, and it is asserted in BOTH
-- directions on purpose:
--
--   * a stranger must see zero  -- catches a policy that is too permissive,
--   * the owner must see one    -- catches a policy set that is missing or
--                                  too tight, which would otherwise let the
--                                  first assertion pass vacuously (a table
--                                  nobody can read is trivially "isolated").
--
-- Privacy shape: this schema spells "private" as an EMPTY
-- visibleToGroupTypes array with no restrictToGroup, which is what
-- can_view_wishlist_item() reads. See the valid_wishlist_privacy_settings
-- check constraint in the baseline migration.
--
-- Convention: see 00_harness_smoke.sql. set_config(..., true) is
-- transaction-local and the runner always rolls the transaction back, so the
-- fixtures below never persist.

create temp table _harness_result (token text);

do $$
declare
  v_visible   int;
  v_orig_role text;
  v_checks    int := 0;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values ('user_test_a', 'testuser_a', 'Test A'),
           ('user_test_b', 'testuser_b', 'Test B');

  insert into wishlist_items (user_id, title, privacy_settings)
    values ('user_test_b', 'Secret Item',
            '{"visibleToGroupTypes": [], "restrictToGroup": null}');

  ---------------------------------------------------------------------------
  -- Impersonate user A, a stranger to user B.
  --
  -- The role switch is what makes policies apply at all: the CLI connects as
  -- a role with rolbypassrls, so claims alone would leave this test vacuous.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_a","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible
    from wishlist_items where user_id = 'user_test_b';

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: user_test_a sees % private wishlist item(s) of user_test_b',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- And the owner must still see their own.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_test_b","role":"authenticated"}', true);

  select count(*) into v_visible
    from wishlist_items where user_id = 'user_test_b';

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: owner user_test_b sees % of their own items, expected 1',
      v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connect role so the token insert below is permitted.
  perform set_config('role', v_orig_role, true);

  if v_checks < 2 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 2. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_01_wishlist_isolation');
end $$;

select token as result from _harness_result;
