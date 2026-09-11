-- =============================================================================
-- rybn: materialize the caller's own celebrated occasion
-- =============================================================================
--
-- Phase 1 derived birthdays for DISPLAY and deliberately materialized nothing,
-- because nothing needed a foreign key yet. Phase 2's tags do: a row in
-- wishlist_item_occasions has to point at something.
--
-- SIGNATURE, and why it is narrower than the design doc's:
--   The spec proposed (p_group_id, p_kind, p_celebrant_id, p_date). Every one
--   of those parameters is attack surface on a SECURITY DEFINER function
--   granted to `authenticated`. p_celebrant_id would let a caller materialize
--   an occasion for somebody whose date they may not see; p_date would let
--   them materialize one on a date that person never entered -- a forged row
--   that then renders to everyone who legitimately CAN see that celebrant.
--
--   Taking no subject at all removes the vector rather than guarding it. The
--   caller is always the celebrant, because you only tag YOUR OWN items, and
--   your own items are for occasions where you are the recipient. Group dates
--   are stored rows created by hand and need no materialization path.
--
-- Idempotent under concurrency via occasions_celebrant_identity: two tags
-- created in the same second resolve to the same row.
create or replace function public.get_or_create_occasion(
  p_kind public.occasion_kind
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  text := (select public.requesting_user_id());
  v_year    integer := extract(year from current_date)::integer;
  v_value   text;
  v_date    date;
  v_id      uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- A group_date is never derived: it is created explicitly, by a person,
  -- through createGroupDate(). Materializing one here would invent an event
  -- nobody scheduled.
  if p_kind = 'group_date' then
    raise exception 'group dates are created explicitly, not materialized'
      using errcode = '22023';
  end if;

  select pi.field_value into v_value
  from profile_info pi
  where pi.user_id = v_caller
    and pi.category = 'dates'
    and pi.field_name = p_kind::text;

  if v_value is null then
    raise exception 'no % on file for this account', p_kind
      using errcode = '22023';
  end if;

  -- Same this-year-or-next rollover the read path uses, through the same
  -- helper, so a tag and the display it appears under cannot disagree about
  -- which year the occasion falls in.
  v_date := public.celebration_date_in_year(v_value, v_year);
  if v_date is null then
    raise exception 'stored % is not a usable date', p_kind
      using errcode = '22023';
  end if;
  if v_date < current_date then
    v_date := public.celebration_date_in_year(v_value, v_year + 1);
  end if;

  insert into public.occasions (kind, celebrant_id, occasion_date, created_by)
  values (p_kind, v_caller, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do nothing;

  -- The insert returns nothing when the row already existed, so read it back
  -- rather than relying on RETURNING.
  select o.id into v_id
  from public.occasions o
  where o.kind = p_kind
    and o.celebrant_id = v_caller
    and o.occasion_year = extract(year from v_date)::integer;

  return v_id;
end;
$$;

grant execute on function public.get_or_create_occasion(public.occasion_kind)
  to authenticated, service_role;
