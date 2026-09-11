-- anniversary_links has exactly one policy, a SELECT admitting either
-- participant, and no write policy at all -- writes go through the
-- SECURITY DEFINER RPCs added in 20260912000002. This file proves:
--
--   1. user_a (the smaller id, canonically) sees the row;
--   2. user_b (the larger id) sees the SAME row -- proving the policy's `or`
--      really admits both sides, not just whichever one happens to be
--      user_a. A policy accidentally written as `using (user_a =
--      requesting_user_id())` alone would pass assertion 1 and fail only
--      this one.
--   3. a third user who shares a GROUP with one of the pair sees ZERO rows.
--      This table has no group_id and no group-membership check in its
--      policy; shared group membership must carry no weight here at all.
--      Assertion 1 already proves the row is readable by somebody, so this
--      measures the exclusion specifically, not an empty table nobody could
--      read regardless of the policy.
--   4. `authenticated` holds none of INSERT/UPDATE/DELETE at the PRIVILEGE
--      layer (three checks, has_table_privilege) -- not merely that no
--      policy admits them. Same reasoning as 16_claim_visibility.sql's
--      assertion 4: Supabase's per-role default privileges grant
--      `authenticated` every DML verb on a newly created public table
--      regardless of what the table's own `grant` line says, confirmed
--      against this project in phase 3 (pg_default_acl showed
--      `authenticated=arwdm`). 20260912000000_anniversary_links.sql carries
--      an explicit `revoke insert, update, delete ... from authenticated`
--      after its grant line specifically so this assertion checks something
--      true rather than something the default-privilege mechanism already
--      contradicted.
--   5. zero policies with cmd in (INSERT, UPDATE, DELETE, ALL), and exactly
--      one PERMISSIVE SELECT policy. This is the population-control check:
--      a row-count write attempt is not available (see below), and a second
--      permissive SELECT policy sitting alongside the correct one would be
--      ORed in and invisible to any check that inspects only the one policy's
--      expression text -- this is the exact shape of phase 2's live incident
--      on wishlist_item_occasions, restated for this table.
--
-- A direct INSERT is not attempted here at all, by the same reasoning
-- 16_claim_visibility.sql's header gives in detail: with no INSERT policy on
-- an RLS-enabled table, and after the revoke above, an attempted write by
-- `authenticated` raises an uncatchable 42501 that would abort this entire
-- file (test-rls.sh sends it as ONE batch and bans `exception when`
-- file-wide). Assertions 4 and 5 are strictly stronger than a row-count
-- attempt would have been: they catch a widened GRANT or a stray write
-- policy even when no write was ever tried.
--
-- Convention: see 00_harness_smoke.sql. Fixture writes happen while
-- impersonating the connecting (RLS-bypassing) role; only the SELECT
-- assertions and catalog reads run as `authenticated`, so `role` is toggled
-- back to the captured `current_user` around fixture mutations and, finally,
-- before the catalog checks and the token insert.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role       text;
  v_checks          int := 0;
  -- Chosen so v_user_a < v_user_b holds as a plain text comparison, matching
  -- the table's own canonical-ordering CHECK -- this fixture must satisfy the
  -- same constraint a real caller's request would.
  v_user_a          text := 'user_annlink_a';
  v_user_b          text := 'user_annlink_b';
  v_comember        text := 'user_annlink_comember';
  v_group           uuid;
  v_link            uuid;
  v_visible         int;
  v_priv_insert     boolean;
  v_priv_update     boolean;
  v_priv_delete     boolean;
  v_write_policies  int;
  v_select_policies int;
begin
  select current_user into v_orig_role;

  insert into user_profiles (id, username, display_name)
    values (v_user_a,   'annlinka',        'Annlink A'),
           (v_user_b,   'annlinkb',        'Annlink B'),
           (v_comember, 'annlinkcomember', 'Annlink Comember');

  -- v_comember shares a group with v_user_a but has nothing to do with the
  -- link itself -- exactly the shape assertion 3 needs: group membership
  -- overlapping ONE participant, proving that overlap grants nothing.
  insert into groups (name, type, invite_code, created_by)
    values ('Annlink Family', 'family', 'ANNLINK1', v_user_a)
    returning id into v_group;

  -- add_group_creator_as_owner() already added v_user_a. v_comember joins
  -- too, sharing the "family" group with v_user_a.
  insert into group_members (group_id, user_id, role)
    values (v_group, v_comember, 'member')
    on conflict do nothing;

  -- The link row itself, written as the connecting (RLS-bypassing) role:
  -- there is no INSERT policy on this table, and after the migration's
  -- revoke, `authenticated` holds no INSERT privilege here either, so this
  -- could not be written any other way from inside this harness.
  insert into anniversary_links (user_a, user_b, status, initiated_by, agreed_date)
    values (v_user_a, v_user_b, 'pending', v_user_a, '2020-06-15')
    returning id into v_link;

  ---------------------------------------------------------------------------
  -- Assertion 1: user_a sees their own link row.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_user_a || '","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from anniversary_links where id = v_link;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: user_a % sees % row(s) of their own anniversary link, expected 1',
      v_user_a, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 2: user_b sees the SAME row. Proves the policy's `or` admits
  -- both sides, not only whichever participant happens to be user_a.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_user_b || '","role":"authenticated"}', true);

  select count(*) into v_visible from anniversary_links where id = v_link;

  if v_visible <> 1 then
    raise exception
      'RLS FAIL: user_b % sees % row(s) of the shared anniversary link, expected 1 -- the policy must admit BOTH sides',
      v_user_b, v_visible;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 3: a third user sharing a GROUP with user_a sees ZERO rows.
  -- Assertion 1 already proved the row is readable by somebody, so this
  -- measures the exclusion specifically, not an empty table nobody could
  -- read regardless of the policy.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"' || v_comember || '","role":"authenticated"}', true);

  select count(*) into v_visible from anniversary_links where id = v_link;

  if v_visible <> 0 then
    raise exception
      'RLS FAIL: group co-member % sees % row(s) of a couple''s anniversary link they are not part of, expected 0 -- shared group membership must not grant visibility',
      v_comember, v_visible;
  end if;
  v_checks := v_checks + 1;

  -- Back to the connecting role for the privilege and policy catalog reads,
  -- as 16_claim_visibility.sql and 15_celebrated_materialization.sql do
  -- before their own has_table_privilege()/pg_policies checks.
  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- Assertion 4 (three checks): `authenticated` must hold none of INSERT,
  -- UPDATE or DELETE on this table at the PRIVILEGE layer. See the file
  -- header for why this is not automatically true from the migration's
  -- `grant select` line alone.
  ---------------------------------------------------------------------------
  select has_table_privilege('authenticated', 'public.anniversary_links', 'INSERT')
    into v_priv_insert;

  if v_priv_insert is distinct from false then
    raise exception
      'WRITE PATH: authenticated holds INSERT privilege on anniversary_links, expected none. A direct insert would only be stopped by RLS (there is no INSERT policy), not by the grant layer, and could not enforce canonical ordering or the shared-group requirement.';
  end if;
  v_checks := v_checks + 1;

  select has_table_privilege('authenticated', 'public.anniversary_links', 'UPDATE')
    into v_priv_update;

  if v_priv_update is distinct from false then
    raise exception
      'WRITE PATH: authenticated holds UPDATE privilege on anniversary_links, expected none.';
  end if;
  v_checks := v_checks + 1;

  select has_table_privilege('authenticated', 'public.anniversary_links', 'DELETE')
    into v_priv_delete;

  if v_priv_delete is distinct from false then
    raise exception
      'WRITE PATH: authenticated holds DELETE privilege on anniversary_links, expected none.';
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Assertion 5 (two checks): population control at the POLICY layer,
  -- independent of assertion 4. Zero policies for any write command, and
  -- exactly one PERMISSIVE SELECT policy -- catching a second, additional
  -- permissive SELECT policy that would be ORed in alongside the correct
  -- one, invisible to any check that filters by expression text.
  ---------------------------------------------------------------------------
  select count(*) into v_write_policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'anniversary_links'
     and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');

  if v_write_policies <> 0 then
    raise exception
      'WRITE PATH: % write polic(y/ies) (INSERT/UPDATE/DELETE/ALL) exist on anniversary_links, expected 0. All writes must go through the SECURITY DEFINER RPCs.',
      v_write_policies;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_select_policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'anniversary_links'
     and cmd = 'SELECT'
     -- PERMISSIVE only. A RESTRICTIVE SELECT policy narrows rather than
     -- widens, so it cannot reopen visibility to a non-participant; counting
     -- it here would fail this assertion for a change that is safe.
     and permissive = 'PERMISSIVE';

  if v_select_policies <> 1 then
    raise exception
      'WRITE PATH: % SELECT polic(y/ies) exist on anniversary_links, expected exactly 1. A second permissive SELECT policy would be ORed in alongside the participant-only one and could reopen visibility invisibly to assertion 3.',
      v_select_policies;
  end if;
  v_checks := v_checks + 1;

  if v_checks < 8 then
    raise exception 'HARNESS FAIL: only % assertion(s) ran, expected at least 8', v_checks;
  end if;

  insert into _harness_result (token) values ('OK_18_anniversary_links');
end $$;

select token as result from _harness_result;
