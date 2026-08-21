-- Proves the RLS harness can impersonate a Clerk user.
-- Depends on no application table, so it is valid before and after the
-- schema baseline.
do $$
declare
  v_sub text;
  v_role text;
begin
  perform set_config('request.jwt.claims',
    '{"sub":"user_harness_smoke","role":"authenticated"}', true);

  select auth.jwt()->>'sub' into v_sub;
  if v_sub is distinct from 'user_harness_smoke' then
    raise exception 'HARNESS FAIL: expected sub=user_harness_smoke, got %', v_sub;
  end if;

  select auth.jwt()->>'role' into v_role;
  if v_role is distinct from 'authenticated' then
    raise exception 'HARNESS FAIL: expected role=authenticated, got %', v_role;
  end if;

  raise notice 'HARNESS OK';
end $$;
