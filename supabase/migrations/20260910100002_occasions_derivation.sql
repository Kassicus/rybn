-- =============================================================================
-- rybn: gift-giving occasions -- derivation
-- =============================================================================

-- The celebration date for a stored 'YYYY-MM-DD' profile date, in a given
-- year. Returns NULL rather than raising on anything malformed.
--
-- This replaces an inline expression that was a latent outage:
-- get_upcoming_dates_for_notifications computed
-- (target_year || '-' || substring(field_value from 6 for 5))::date, which for
-- a 2000-02-29 birthday in a non-leap target year cast '2027-02-29' and raised
-- "date/time field value out of range". Evaluated in a WHERE clause over every
-- dates row, ONE such birthday broke the reminder run for every user.
--
-- Feb 29 clamps to Feb 28 in common years -- the convention most calendars
-- use, and the one that keeps the reminder in the same month.
create or replace function public.celebration_date_in_year(
  p_field_value text,
  p_target_year integer
)
returns date
language plpgsql
immutable
as $$
declare
  v_md text;
begin
  if p_field_value is null or p_field_value !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;

  v_md := substring(p_field_value from 6 for 5);

  if v_md = '02-29' and not (
    (p_target_year % 4 = 0 and p_target_year % 100 <> 0)
    or p_target_year % 400 = 0
  ) then
    return (p_target_year || '-02-28')::date;
  end if;

  return (p_target_year || '-' || v_md)::date;
end;
$$;

-- Every occasion the CALLER may see, within p_days_ahead.
--
-- Takes NO viewer parameter, deliberately. A p_viewer_id argument on a
-- SECURITY DEFINER function granted to `authenticated` lets any signed-in
-- caller ask for anyone else's view -- which is exactly why
-- get_upcoming_dates_for_notifications is granted to service_role only. Pinning
-- to requesting_user_id() is the same defence accept_group_invitation() and
-- join_group_with_code() use, and it is what makes an `authenticated` grant
-- safe here.
create or replace function public.get_upcoming_occasions(
  p_days_ahead integer default 30
)
returns table(
  occasion_id uuid,
  kind public.occasion_kind,
  name text,
  occasion_date date,
  celebrant_id text,
  celebrant_username text,
  celebrant_display_name text,
  group_id uuid,
  group_name text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_viewer text := (select public.requesting_user_id());
  v_year   integer := extract(year from current_date)::integer;
  v_until  date := (current_date + (p_days_ahead || ' days')::interval)::date;
begin
  if v_viewer is null then
    return;
  end if;

  return query
  -- Derived birthdays and anniversaries. One row per celebrant per kind,
  -- never one per shared group: can_view_field() already collapses the group
  -- dimension by returning true if ANY shared group qualifies.
  select
    o.id,
    pi.field_name::public.occasion_kind,
    null::text,
    d.celebration,
    pi.user_id,
    up.username,
    up.display_name,
    null::uuid,
    null::text
  from profile_info pi
  join user_profiles up on up.id = pi.user_id
  cross join lateral (
    select case
      when public.celebration_date_in_year(pi.field_value, v_year) >= current_date
        then public.celebration_date_in_year(pi.field_value, v_year)
      else public.celebration_date_in_year(pi.field_value, v_year + 1)
    end as celebration
  ) d
  -- The materialized twin, when phase 2 has created one. NULL until then, and
  -- the UI must not depend on it being present.
  left join occasions o
    on o.celebrant_id = pi.user_id
   and o.kind = pi.field_name::public.occasion_kind
   and o.occasion_year = extract(year from d.celebration)::integer
  where pi.category = 'dates'
    and pi.field_name in ('birthday', 'anniversary')
    and d.celebration is not null
    and d.celebration between current_date and v_until
    and public.can_view_field(pi.user_id, v_viewer, pi.privacy_settings)

  union all

  -- Stored group dates for the caller's groups.
  select
    o.id,
    o.kind,
    o.name,
    o.occasion_date,
    null::text,
    null::text,
    null::text,
    o.group_id,
    g.name
  from occasions o
  join groups g on g.id = o.group_id
  where o.kind = 'group_date'
    and o.occasion_date between current_date and v_until
    and public.is_group_member(o.group_id, v_viewer)

  order by 4;
end;
$$;

grant execute on function public.celebration_date_in_year(text, integer)
  to authenticated, service_role;
grant execute on function public.get_upcoming_occasions(integer)
  to authenticated, service_role;

-- =============================================================================
-- Refactor the existing reminder function to use the helper above.
--
-- Copied verbatim from
-- supabase/migrations/20260821000000_clerk_native_baseline.sql:985-1043, with
-- ONLY two substitutions: the inline
-- (target_year || '-' || substring(pi.field_value from 6 for 5))::date
-- expression -- the exact expression confirmed above to raise on a Feb-29
-- birthday in a non-leap target year -- is replaced, in both the select list
-- and the WHERE clause, by public.celebration_date_in_year(pi.field_value,
-- target_year). Nothing else changes: not the signature, not SECURITY
-- DEFINER, not the can_view_field gate, not the `not exists` dedup against
-- date_notifications. The grant stays service_role only.
-- =============================================================================
create or replace function public.get_upcoming_dates_for_notifications(
  days_ahead integer default 1,
  target_year integer default (extract(year from current_date))::integer
)
returns table(
  celebrant_id text,
  celebrant_username text,
  field_name text,
  field_value text,
  celebration_date date,
  group_id uuid,
  group_name text,
  group_type public.group_type,
  notified_user_id text,
  notified_user_email text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
  select distinct
    pi.user_id as celebrant_id,
    up.username as celebrant_username,
    pi.field_name,
    pi.field_value,
    public.celebration_date_in_year(pi.field_value, target_year) as celebration_date,
    g.id as group_id,
    g.name as group_name,
    g.type as group_type,
    gm.user_id as notified_user_id,
    notified.email as notified_user_email
  from profile_info pi
  inner join user_profiles up on pi.user_id = up.id
  inner join group_members gm_celebrant on pi.user_id = gm_celebrant.user_id
  inner join groups g on gm_celebrant.group_id = g.id
  inner join group_members gm on g.id = gm.group_id and gm.user_id <> pi.user_id
  inner join user_profiles notified on gm.user_id = notified.id
  where
    pi.category = 'dates'
    and pi.field_name in ('birthday', 'anniversary')
    and pi.field_value is not null
    and pi.field_value <> ''
    and public.celebration_date_in_year(pi.field_value, target_year)
      between current_date and (current_date + (days_ahead || ' days')::interval)::date
    and can_view_field(pi.user_id, gm.user_id, pi.privacy_settings)
    and not exists (
      select 1 from date_notifications dn
      where dn.celebrant_id = pi.user_id
        and dn.notified_user_id = gm.user_id
        and dn.field_name = pi.field_name
        and dn.notification_year = target_year
        and dn.group_id = g.id
    );
end;
$$;
