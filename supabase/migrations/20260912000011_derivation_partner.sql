-- =============================================================================
-- rybn: get_upcoming_occasions() collapses a linked couple's anniversary into
-- ONE row, per viewer
-- =============================================================================
--
-- Task 4 taught get_or_create_celebrated_occasion() to MATERIALIZE a linked
-- couple's anniversary under one row (20260912000007 .. 000010) and Task 2
-- taught the occasions SELECT policy to admit a viewer through either half of
-- that row (20260912000002). Neither touched get_upcoming_occasions(): its
-- derived branch still emits one row per profile_info date, so a caller who
-- can see BOTH halves of a confirmed couple's anniversary still saw it TWICE
-- -- once keyed to each partner -- because that branch never joins
-- anniversary_links at all. This migration is the last piece: the derived
-- listing now collapses to the same one-row-per-couple shape the storage and
-- read-policy layers already give a materialized occasion.
--
-- Postgres will not change a function's return type in place (adding columns
-- to RETURNS TABLE changes the type), so this is DROP + CREATE, in one
-- migration, on live production. Approved for this task specifically -- see
-- the task brief. Re-granting after the recreate is NOT optional: DROP
-- FUNCTION drops its grants, and this RPC is how every occasion surface in
-- the app reads its data.
--
-- THE COLLAPSE IS PER VIEWER, NOT GLOBAL. Merging whenever a confirmed link
-- exists -- regardless of what THIS caller can see -- would hide a person's
-- anniversary from a viewer who can see only their half: that viewer cannot
-- see the merged row (it requires both dates visible, per the couple arm's
-- own two can_view_field() calls below), so a global merge would produce
-- ZERO rows for them instead of the one row they are entitled to. The fix is
-- the "not (...)" exclusion added to the existing per-person branch: a
-- person is suppressed from THAT branch only when THIS VIEWER can also see
-- their partner's date -- exactly the condition under which the new couple
-- arm fires instead. Get either direction of that condition wrong and you
-- either double-emit (both arms fire for the same viewer) or hide someone's
-- anniversary from a viewer entitled to see it (neither arm fires). See the
-- task report for the mutation testing that pins this down.
--
-- THREE new columns -- partner_id, partner_username, partner_display_name --
-- appended after celebrant_display_name, per the task brief. Every existing
-- branch (the per-person derivation and the stored group_date branch) now
-- selects null::text, null::text, null::text for them; only the new couple
-- arm populates them. 12_occasion_derivation.sql calls this function by
-- COLUMN NAME, never positionally, so this is a compatible, additive change
-- -- that file is untouched by this migration and must keep passing exactly
-- as it did before.
drop function if exists public.get_upcoming_occasions(integer);

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
  partner_id text,
  partner_username text,
  partner_display_name text,
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
  -- Derived birthdays and anniversaries, one row per celebrant per kind --
  -- EXCEPT a confirmed anniversary couple both of whose dates THIS VIEWER can
  -- see, which the "not (...)" exclusion below removes from here so the
  -- couple arm can emit it once instead. can_view_field() already collapses
  -- the group dimension by returning true if ANY shared group qualifies, so
  -- this still never fans out per shared group.
  select
    o.id,
    pi.field_name::public.occasion_kind,
    null::text,
    d.celebration,
    pi.user_id,
    up.username,
    up.display_name,
    null::text,
    null::text,
    null::text,
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
    -- PER-VIEWER collapse. This person is suppressed from this branch ONLY
    -- when a CONFIRMED anniversary link exists AND this viewer can also see
    -- the partner's own date -- exactly the condition the couple arm below
    -- requires to emit the merged row in this person's place. A viewer who
    -- cannot see the partner's date leaves this exists() false, so this row
    -- stays -- that is what makes a partner-only-visible viewer get exactly
    -- one (unmerged) row instead of zero.
    and not (
      pi.field_name = 'anniversary'
      and exists (
        select 1 from anniversary_links l2
        join profile_info p2
          on p2.category = 'dates' and p2.field_name = 'anniversary'
         and p2.user_id = case when l2.user_a = pi.user_id then l2.user_b else l2.user_a end
        where l2.status = 'confirmed'
          and pi.user_id in (l2.user_a, l2.user_b)
          and public.can_view_field(p2.user_id, v_viewer, p2.privacy_settings)
      )
    )

  union all

  -- Arm 2: a confirmed couple BOTH of whose dates this viewer can see. One
  -- row, keyed to the canonical partner (user_a, per anniversary_links'
  -- canonical-ordering CHECK -- the same direction get_or_create_celebrated_
  -- occasion resolves to), carrying both names. Mutually exclusive with the
  -- branch above for this viewer: whenever both can_view_field() calls below
  -- hold, the exclusion above has already removed both individual rows for
  -- this couple.
  select
    o.id,
    'anniversary'::public.occasion_kind,
    null::text,
    d.celebration,
    l.user_a,
    ua.username,
    ua.display_name,
    l.user_b,
    ub.username,
    ub.display_name,
    null::uuid,
    null::text
  from anniversary_links l
  join user_profiles ua on ua.id = l.user_a
  join user_profiles ub on ub.id = l.user_b
  join profile_info pa
    on pa.user_id = l.user_a and pa.category = 'dates' and pa.field_name = 'anniversary'
  join profile_info pb
    on pb.user_id = l.user_b and pb.category = 'dates' and pb.field_name = 'anniversary'
  cross join lateral (
    select case
      when public.celebration_date_in_year(pa.field_value, v_year) >= current_date
        then public.celebration_date_in_year(pa.field_value, v_year)
      else public.celebration_date_in_year(pa.field_value, v_year + 1)
    end as celebration
  ) d
  left join occasions o
    on o.celebrant_id = l.user_a and o.kind = 'anniversary'
   and o.occasion_year = extract(year from d.celebration)::integer
  where l.status = 'confirmed'
    and d.celebration is not null
    and d.celebration between current_date and v_until
    and public.can_view_field(l.user_a, v_viewer, pa.privacy_settings)
    and public.can_view_field(l.user_b, v_viewer, pb.privacy_settings)

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

-- DROP FUNCTION above dropped every grant on this RPC. Without this, every
-- occasion surface in the app goes blank for `authenticated` immediately.
grant execute on function public.get_upcoming_occasions(integer)
  to authenticated, service_role;
