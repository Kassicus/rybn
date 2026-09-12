-- =============================================================================
-- rybn: resolve a linked couple to ONE celebrated occasion row
-- =============================================================================
--
-- get_or_create_celebrated_occasion (20260911100000) always materialized
-- under p_celebrant_id, the celebrant the CALLER named. For a linked couple
-- that produces TWO rows for one event -- one keyed to each partner -- which
-- is the exact defect anniversary_links (Task 1) and occasions.partner_id
-- (Task 2) exist to remove. This migration adds the resolution: for
-- kind = 'anniversary', look up the caller-named celebrant's CONFIRMED
-- link (if any) and materialize under the link's canonical user_a instead,
-- carrying user_b as partner_id.
--
-- CANONICAL DIRECTION IS LOAD-BEARING, NOT COSMETIC. The resolution below
-- always assigns `v_target := l.user_a` (the lexicographically smaller id)
-- regardless of which partner is p_celebrant_id, and `v_partner := ` the
-- other one. This must never be reversed. unlink_anniversary
-- (20260912000005) clears partner_id with
--   where celebrant_id = v_link.user_a and partner_id = v_link.user_b
-- -- it does not, and cannot, look for a mirror row keyed to user_b. If this
-- function ever materialized celebrant_id = user_b / partner_id = user_a
-- instead (the reverse), unlink_anniversary's UPDATE would not match that
-- row at all: its partner_id would survive the unlink untouched, and the
-- partner branch of the occasions SELECT policy
-- (20260912000002_occasion_partner.sql) would keep admitting a viewer who
-- can see the old partner's date -- silently re-granting access to a couple
-- that had just broken up, through a row nothing above this comment knows
-- to look for. Always keying to user_a is what keeps "the occasion this
-- link controls" and "the occasion unlink_anniversary clears" the same row.
--
-- The privacy gate above this resolution runs against the celebrant the
-- CALLER named, and that does not change: a caller entitled to act on Sam's
-- anniversary stays entitled to, whichever of the two ids the row ends up
-- stored under -- that storage detail is internal and must not become a
-- reason to refuse them. The occasion_date likewise still comes from the
-- celebrant the caller named; after Task 3 (confirm_anniversary_link adopts
-- the agreed date for both partners) both halves of a confirmed couple hold
-- the same date, so this is the same value either way, and if they ever
-- drift apart the caller gets the date they could actually see.
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
    select case when l.user_a = p_celebrant_id then l.user_b else l.user_a end,
           l.user_a
      into v_partner, v_target
      from public.anniversary_links l
     where l.status = 'confirmed'
       and p_celebrant_id in (l.user_a, l.user_b);

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
