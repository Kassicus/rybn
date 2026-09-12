-- =============================================================================
-- rybn: fix a self-referencing partner_id when the NON-canonical partner calls
-- =============================================================================
--
-- CORRECTIVE MIGRATION for 20260912000007_canonical_anniversary.sql, which
-- already reached production -- a migration is the historical record of what
-- actually ran, so that file is not edited in place; this one supersedes its
-- one function body via `create or replace`.
--
-- CRITICAL: 20260912000007's resolution computed v_partner with
--
--   select case when l.user_a = p_celebrant_id then l.user_b else l.user_a end,
--          l.user_a
--     into v_partner, v_target
--     from ...
--
-- v_target is UNCONDITIONALLY l.user_a (correct -- the canonical partner is
-- always where the row is keyed). But the CASE feeding v_partner branches on
-- p_celebrant_id, the id the CALLER named, not on which value v_target ends
-- up holding. When the caller names the NON-canonical partner
-- (p_celebrant_id = l.user_b), `l.user_a = p_celebrant_id` is false, so the
-- ELSE branch fires and v_partner is also set to l.user_a -- the same value
-- as v_target. The insert then attempts celebrant_id = l.user_a, partner_id
-- = l.user_a: a self-referencing row, rejected by
-- occasions_partner_not_self (20260912000004) with a check_violation. Found
-- immediately when Task 4's own RLS test called the function as the
-- non-canonical partner (assertion 7's second call) -- confirmed against
-- the live linked project inside the test harness's own begin/rollback
-- wrapper, so nothing persisted; no corrective data cleanup is needed here,
-- only the function body.
--
-- The fix removes the CASE entirely. v_target is always l.user_a, so the
-- occasion's partner is always l.user_a's confirmed counterpart --
-- unconditionally l.user_b, regardless of which of the two ids the caller
-- named:
--
--   select l.user_b, l.user_a into v_partner, v_target from ...
--
-- This is simpler, not merely fixed: nothing about which id the caller
-- named should ever influence WHICH of the two stored ids becomes the
-- partner, once v_target is pinned to the canonical id. Confirmed against
-- the live linked project inside begin/rollback: calling with
-- p_celebrant_id equal to either partner now produces the identical
-- (celebrant_id = user_a, partner_id = user_b) row, with no self-reference
-- in either direction.
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
  --
  -- FIXED (this migration): v_partner is now always l.user_b, unconditionally
  -- -- see this migration's header for why a CASE branching on p_celebrant_id
  -- produced a self-referencing partner_id when the caller named the
  -- non-canonical partner.
  v_target  := p_celebrant_id;
  v_partner := null;

  if p_kind = 'anniversary' then
    select l.user_b, l.user_a
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
