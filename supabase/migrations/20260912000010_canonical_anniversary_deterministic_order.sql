-- =============================================================================
-- rybn: deterministic order for the couple-resolution lookup (defense-in-depth)
-- =============================================================================
--
-- MINOR, round-1 review of Task 4. get_or_create_celebrated_occasion's
-- couple-resolution `select ... into` (20260912000008) has no ORDER BY:
--
--   select l.user_b, l.user_a
--     into v_partner, v_target
--     from public.anniversary_links l
--    where l.status = 'confirmed'
--      and p_celebrant_id in (l.user_a, l.user_b);
--
-- Today this can return at most one row: anniversary_link_members' PRIMARY
-- KEY plus anniversary_links_one_confirmed_a/_b (20260912000000) together
-- guarantee at most one CONFIRMED link per person, on either side, for
-- every authenticated-reachable writer -- confirm_anniversary_link is the
-- only one, and a second confirm for either participant is refused by
-- anniversary_link_members_pkey before a second row could ever exist. So
-- this is unreachable through the RPCs today, not a live bug.
--
-- It is still worth closing as defense-in-depth: without an ORDER BY, a
-- `select ... into` against a query that (through a future refactor, a
-- direct service_role write, or a constraint loosened without this
-- resolution being revisited) ever returned more than one row would take
-- PL/pgSQL's documented behaviour of "the first row is assigned, the rest
-- discarded" -- but "first" with no ORDER BY is whatever order the planner
-- happens to produce, which is not guaranteed stable across a replan, an
-- index choice, or a Postgres version. An arbitrary pick is a worse failure
-- mode than a deterministic one even when it should never be exercised.
--
-- Fix: `order by l.id` -- any deterministic tiebreak works, since the
-- state it defends against is not meant to occur; `id` is already indexed
-- (primary key) and carries no other significance here.
--
-- THIS IS NOW THE LIVE BODY (a reader following a "see the resolution's
-- header" pointer should open THIS file, not 20260912000008 or
-- 20260912000007). Recap, in full in 20260912000008's own header: v_target
-- is always l.user_a (the canonical, lexicographically smaller id), never
-- reversed. Reversing it would materialize celebrant_id = user_b /
-- partner_id = user_a instead -- a mirror row that unlink_anniversary's own
-- `where celebrant_id = v_link.user_a and partner_id = v_link.user_b` could
-- never find, stranding a stale partner_id after a breakup and leaving the
-- occasions SELECT policy's partner branch admitting a viewer indefinitely.
-- Unaffected by the ORDER BY added here.
create or replace function public.get_or_create_celebrated_occasion(
  p_celebrant_id text,
  p_kind public.occasion_kind
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_year   integer := extract(year from current_date)::integer;
  v_row    record;
  v_date   date;
  v_id     uuid;
  v_target text;
  v_partner text;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- A group_date is created explicitly by a person; there is nothing to derive.
  if p_kind = 'group_date' then
    raise exception 'group dates are created explicitly, not materialized'
      using errcode = '22023';
  end if;

  select pi.field_value, pi.privacy_settings into v_row
  from profile_info pi
  where pi.user_id = p_celebrant_id
    and pi.category = 'dates'
    and pi.field_name = p_kind::text;

  -- Same message whether the date does not exist or the caller may not see it.
  -- Distinguishing them would make this an oracle for which dates are on file,
  -- which is exactly what can_view_field exists to prevent.
  if v_row is null
     or not public.can_view_field(p_celebrant_id, v_caller, v_row.privacy_settings)
  then
    raise exception 'no visible % for that person' , p_kind
      using errcode = '22023';
  end if;

  -- Resolve a linked couple to ONE row. The privacy gate above has already run
  -- against the celebrant the CALLER named -- a caller entitled to act on Sam's
  -- anniversary stays entitled to, and which of the two ids the row is stored
  -- under is an internal detail that must not become a reason to refuse them.
  v_target  := p_celebrant_id;
  v_partner := null;

  if p_kind = 'anniversary' then
    -- ORDER BY added (this migration): defense-in-depth only -- see the
    -- migration header for why more than one row is unreachable through the
    -- RPCs today, and why an explicit deterministic tiebreak is still worth
    -- having rather than relying on planner-dependent row order.
    select l.user_b, l.user_a
      into v_partner, v_target
      from public.anniversary_links l
     where l.status = 'confirmed'
       and p_celebrant_id in (l.user_a, l.user_b)
     order by l.id
     limit 1;

    if v_target is null then
      v_target  := p_celebrant_id;
      v_partner := null;
    end if;
  end if;

  v_date := public.celebration_date_in_year(v_row.field_value, v_year);
  if v_date is null then
    raise exception 'stored % is not a usable date', p_kind
      using errcode = '22023';
  end if;
  if v_date < current_date then
    v_date := public.celebration_date_in_year(v_row.field_value, v_year + 1);
  end if;

  insert into public.occasions (kind, celebrant_id, partner_id, occasion_date, created_by)
  values (p_kind, v_target, v_partner, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do update set occasion_date = excluded.occasion_date,
                partner_id    = excluded.partner_id
  returning id into v_id;

  -- Should be unreachable: RETURNING on `do update` always produces a row on
  -- this path -- see 20260911000001_get_or_create_occasion_returning.sql's
  -- header for the full analysis (same conflict target shape, same
  -- reasoning). Kept as a backstop because an unreachable check costs
  -- nothing and a reachable one would mean that analysis was wrong.
  if v_id is null then
    raise exception 'failed to materialize % for %', p_kind, p_celebrant_id
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

grant execute on function
  public.get_or_create_celebrated_occasion(text, public.occasion_kind)
  to authenticated, service_role;
