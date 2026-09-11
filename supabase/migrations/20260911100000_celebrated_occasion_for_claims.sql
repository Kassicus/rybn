-- =============================================================================
-- rybn: materialize SOMEBODY ELSE'S celebrated occasion, for claiming
-- =============================================================================
--
-- get_or_create_occasion(p_kind) (20260911000000) takes no subject and always
-- materializes the CALLER's occasion. That was right for tagging -- you only
-- tag your own items. Claiming inverts it: a giver claiming an item on Mom's
-- list needs MOM's occasion row, and that signature cannot produce one.
--
-- So this function DOES take a subject, and therefore has to earn it. The
-- guard is the same one the read path uses: can_view_field() against the
-- celebrant's own privacy settings for that date. A caller who cannot SEE
-- somebody's birthday cannot materialize an occasion for it -- otherwise this
-- becomes an existence oracle for dates the privacy model hides, and worse, a
-- way to plant rows referencing people you have no relationship with.
--
-- It derives the date itself rather than accepting one, for the same reason
-- 20260911000000 does: a p_date parameter would let a caller forge an occasion
-- on a date the celebrant never entered.
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

  v_date := public.celebration_date_in_year(v_row.field_value, v_year);
  if v_date is null then
    raise exception 'stored % is not a usable date', p_kind
      using errcode = '22023';
  end if;
  if v_date < current_date then
    v_date := public.celebration_date_in_year(v_row.field_value, v_year + 1);
  end if;

  insert into public.occasions (kind, celebrant_id, occasion_date, created_by)
  values (p_kind, p_celebrant_id, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do update set occasion_date = excluded.occasion_date
  returning id into v_id;

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
