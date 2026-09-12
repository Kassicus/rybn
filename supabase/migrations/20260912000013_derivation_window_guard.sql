-- =============================================================================
-- rybn: get_upcoming_occasions()'s per-person exclusion must require the
-- SAME window condition the couple arm requires, not just the SAME
-- visibility condition
-- =============================================================================
--
-- CORRECTIVE MIGRATION for 20260912000011_derivation_partner.sql, which
-- already reached production -- a migration is the historical record of what
-- actually ran, so that file is not edited in place (its header comments ARE
-- corrected in place, separately, since a comment-only change to an applied
-- migration is this plan's established exception -- see the
-- `-- CORRECTED (20260912000013):` markers added there). This migration
-- supersedes get_upcoming_occasions' body with `create or replace`. No
-- return-type change (the columns are identical to 20260912000011's), so no
-- DROP FUNCTION is needed -- CREATE OR REPLACE on an unchanged signature
-- preserves the object's existing grants, and the explicit re-grant below is
-- kept anyway, matching this plan's established convention
-- (20260912000005 does the same for a plain create-or-replace).
--
-- CRITICAL, round-1 review. Reproduced live, entirely through the shipped
-- RPCs, inside begin/rollback:
--
--   1. A requests a link with B, agreed_date 9 days out; B confirms.
--   2. Before 20260912000012's fix, confirming only ever updated B's
--      (the confirmer's) profile_info date to the agreed value -- A's stayed
--      whatever it was before, ~92 days out in the reproduction.
--   3. A viewer who can see BOTH dates calls get_upcoming_occasions(30) (the
--      app's own default window). Result: ZERO rows -- even though B's own
--      date is 9 days out, well inside the window, and the couple is
--      genuinely confirmed and genuinely visible.
--
-- 20260912000012 fixes the ROOT of that specific reproduction (both
-- partners' dates now agree at confirm time). This migration fixes the
-- GUARD, independently, because dates can still diverge again at any time
-- after confirming -- either partner can edit their own profile_info
-- anniversary field with nothing to keep the other in sync -- and the
-- exclusion below must not depend on that never happening.
--
-- ROOT CAUSE IN THIS FILE, SPECIFICALLY. The per-person branch's exclusion
-- (20260912000011) suppresses a person whenever a confirmed link exists AND
-- the viewer can see the partner's date:
--
--   and not (
--     pi.field_name = 'anniversary'
--     and exists (
--       select 1 from anniversary_links l2
--       join profile_info p2 on ... p2.user_id = <the partner of pi.user_id>
--       where l2.status = 'confirmed'
--         and pi.user_id in (l2.user_a, l2.user_b)
--         and public.can_view_field(p2.user_id, v_viewer, p2.privacy_settings)
--     )
--   )
--
-- The couple arm requires that SAME visibility condition (both
-- can_view_field() calls) PLUS a window condition:
-- `d.celebration is not null and d.celebration between current_date and
-- v_until`, where `d` derives from `pa.field_value` -- user_a's (the
-- CANONICAL partner's) own profile date, exclusively. The exclusion had no
-- equivalent window check at all. So whenever user_a's date falls outside
-- the window and user_b's falls inside it, for a viewer who can see both:
-- the exclusion still fires for user_b (it only checked visibility, not
-- user_a's window), removing user_b's individual row -- and the couple arm
-- still declines to fire (user_a's date is out of window) -- so NEITHER arm
-- emits a row for a viewer entitled to see user_b's genuinely-upcoming
-- anniversary. Data visible before Task 5's own commit went silently
-- missing, with no error.
--
-- 20260912000011's OWN header claimed the exclusion fires under "exactly"
-- the couple arm's firing condition. That was false in one direction: every
-- viewer for whom the couple arm fires DOES have the exclusion fire for both
-- individual rows (that direction holds), but the CONVERSE does not -- the
-- exclusion could fire without the couple arm being able to, which is
-- exactly the gap above. The two are now made genuinely complementary by
-- this fix, not merely re-described as such.
--
-- FIX: give the exclusion's exists() the identical non-null-and-in-window
-- predicate the couple arm has, computed the identical way -- from
-- l2.user_a's own profile_info anniversary row, via the same
-- celebration_date_in_year() rollover logic. This makes "the exclusion fires
-- for pi.user_id" and "the couple arm would fire for this link" the same
-- condition: both now require status = 'confirmed', both can_view_field()
-- calls (this exists() call's own, ANDed together with the OUTER where
-- clause's own can_view_field(pi.user_id, ...) as a separate top-level
-- conjunct of the SAME where clause -- both conjuncts must hold
-- simultaneously for this row to survive; that is a property of AND, not of
-- which one Postgres happens to evaluate first, and SQL makes no guarantee
-- about evaluation order for a conjunction), AND user_a's own date non-null
-- and in window. Verified by mutation, see the task report: reproducing the
-- original bug fixture (user_a's date out of window, user_b's in window,
-- viewer sees both) now yields exactly 1 row -- user_b's own individual row,
-- partner_id NULL, since the couple arm still correctly declines to fire
-- (user_a's own date is not upcoming) and the exclusion no longer removes
-- the one row that IS.
--
-- SECOND SYMPTOM, SAME ROOT, LEFT AS-IS. When both dates are in window but
-- differ, the merged row's occasion_date is `pa`'s (user_a's) date --
-- neither necessarily the agreed date nor the sooner of the two. This
-- migration does not change that: fixing 20260912000012's root (both
-- partners' profile_info dates are written identically at confirm time)
-- makes the divergent-but-both-in-window case unreachable through the
-- confirm flow, the same way it makes the reproduction above unreachable at
-- its root. It remains theoretically reachable if a partner edits their own
-- date after confirming without the other's date also changing -- an
-- existing, documented gap (see 20260912000012's header) this migration does
-- not attempt to close.
--
-- CORRECTED (20260912000014): this paragraph originally justified leaving
-- the couple arm keyed on the canonical partner's LIVE profile_info date
-- (rather than switching it to `agreed_date`) by claiming get_or_create_
-- celebrated_occasion's own materialization "re-derives from the CANONICAL
-- partner's own current profile_info date every time, exactly mirroring
-- this arm's choice." That is false, and was never verified before being
-- written -- checked live with the two dates deliberately drifted: get_or_
-- create_celebrated_occasion derives from `p_celebrant_id`, i.e. WHICHEVER
-- partner the CALLER named, then upserts under the canonical id with
-- `do update set occasion_date = excluded.occasion_date` -- so the
-- materialized date is last-writer-wins by whoever last called it as
-- either partner, not a stable function of the canonical partner's own
-- data. The two paths (this arm's derivation and that function's
-- materialization) do NOT provably agree, and no comment in this codebase
-- should claim they do.
--
-- The choice to key this arm on the canonical partner's live profile_info
-- date stands anyway, for a different and correct reason: a listing should
-- reflect the celebrant's CURRENTLY STATED date, and freezing it at the
-- (potentially stale, potentially simply wrong) `agreed_date` snapshot
-- would stop a couple from correcting a genuinely mistaken date after
-- confirming. `20260912000014_confirm_link_reconciles_occasion_date.sql`
-- separately closes the specific inconsistency this migration's window-axis
-- fix exists for (an already-MATERIALIZED occasion's stale occasion_date
-- after a confirm) without touching this arm's own derivation choice.
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
  -- see AND whose canonical (user_a) date is itself due within the window,
  -- which the "not (...)" exclusion below removes from here so the couple
  -- arm can emit it once instead. can_view_field() already collapses the
  -- group dimension by returning true if ANY shared group qualifies, so this
  -- still never fans out per shared group.
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
    -- PER-VIEWER collapse, genuinely complementary with the couple arm
    -- below. This person is suppressed from this branch ONLY when the
    -- couple arm would ACTUALLY fire in their place: a CONFIRMED anniversary
    -- link, this viewer able to see the partner's own date (the same
    -- visibility half the outer WHERE clause already established for
    -- pi.user_id), AND the link's CANONICAL (user_a) partner's own date
    -- non-null and due within this same window -- computed identically to
    -- the couple arm's own `d` below, from l2.user_a's profile_info row.
    --
    -- FIXED (20260912000013): the window conjunct (`d2.celebration is not
    -- null and d2.celebration between current_date and v_until`) is new.
    -- Its absence let this exclusion fire whenever a confirmed, visible
    -- link existed AT ALL, with no regard for whether the couple arm could
    -- actually emit a replacement row -- silently dropping a person's
    -- otherwise-visible, in-window anniversary whenever their canonical
    -- partner's own date happened to fall outside the window. See this
    -- migration's header for the full reproduction.
    and not (
      pi.field_name = 'anniversary'
      and exists (
        select 1 from anniversary_links l2
        join profile_info p2
          on p2.category = 'dates' and p2.field_name = 'anniversary'
         and p2.user_id = case when l2.user_a = pi.user_id then l2.user_b else l2.user_a end
        join profile_info pa2
          on pa2.user_id = l2.user_a and pa2.category = 'dates' and pa2.field_name = 'anniversary'
        cross join lateral (
          select case
            when public.celebration_date_in_year(pa2.field_value, v_year) >= current_date
              then public.celebration_date_in_year(pa2.field_value, v_year)
            else public.celebration_date_in_year(pa2.field_value, v_year + 1)
          end as celebration
        ) d2
        where l2.status = 'confirmed'
          and pi.user_id in (l2.user_a, l2.user_b)
          and public.can_view_field(p2.user_id, v_viewer, p2.privacy_settings)
          and d2.celebration is not null
          and d2.celebration between current_date and v_until
      )
    )

  union all

  -- Arm 2: a confirmed couple BOTH of whose dates this viewer can see, AND
  -- whose canonical (user_a) date is itself due within the window. One row,
  -- keyed to the canonical partner (user_a, per anniversary_links'
  -- canonical-ordering CHECK -- the same direction get_or_create_celebrated_
  -- occasion resolves to), carrying both names. Genuinely mutually exclusive
  -- with the branch above for this viewer, per the fix in this migration:
  -- whenever this arm's conditions hold, the exclusion above has removed
  -- both individual rows for this couple -- and, conversely, whenever the
  -- exclusion removed an individual row, this arm's conditions do hold, so a
  -- row is never simply lost between the two.
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

-- Defensive, matching this plan's established convention for a create-or-
-- replace RPC migration (e.g. 20260912000005): CREATE OR REPLACE on an
-- unchanged signature does not itself drop grants, but re-asserting them
-- costs nothing and keeps every RPC migration in this plan uniform.
grant execute on function public.get_upcoming_occasions(integer)
  to authenticated, service_role;
