-- =============================================================================
-- rybn: a partnered occasion's date comes from the CANONICAL partner, not
--       from whichever celebrant the caller happened to name
-- =============================================================================
--
-- CORRECTIVE MIGRATION for the chain that has defined
-- get_or_create_celebrated_occasion(text, public.occasion_kind):
-- 20260911100000 (original), 20260912000007 (couple resolution, shipped with
-- a self-referencing partner_id bug), 20260912000008 (that bug fixed), and
-- 20260912000010 (deterministic ORDER BY). None of those is edited in place;
-- each already reached production and is the historical record of what ran.
--
-- THIS IS NOW THE LIVE BODY.
--
-- POINTER CORRECTION (finding M-fold-in), stated here because it cannot be
-- stated where it went wrong: 20260912000008:48-49 tells a reader "THIS IS
-- NOW THE LIVE BODY", and 20260912000010:36-38 tells a reader the opposite --
-- open ...0010, not ...0008. Both claims shipped, and a reader landing on
-- ...0008 was told it was current while it in fact holds the superseded CASE.
-- Both files are now stale regardless. So that a future reader does not have
-- to guess which migration won, this function now carries a
-- `comment on function` naming its live body, which is readable from the
-- database (\df+, obj_description) rather than from whichever file was opened
-- first -- and which a later corrective migration updates as a matter of
-- course, since it ships in the same statement batch as the body it names.
--
-- -----------------------------------------------------------------------------
-- FINDING I4: the shared occasion's date was last-writer-wins.
-- -----------------------------------------------------------------------------
--
-- v_date was derived from p_celebrant_id -- whoever the CALLER named -- and
-- then upserted under the CANONICAL id with
-- `do update set occasion_date = excluded.occasion_date`. So one viewer
-- materializing could rewrite the date another viewer's claim was scoped to.
-- Reproduced on the live project through granted RPCs, inside
-- begin/rollback, with the couple's two profile dates deliberately drifted:
--
--   A materializes (p_celebrant_id = user_a) -> row date 2026-10-22
--   B materializes (p_celebrant_id = user_b) -> SAME row, date 2026-09-14
--
-- This is not cosmetic. 20260911100002_claim_rpcs.sql releases every claim
-- whose `o.occasion_date < current_date`, so a viewer shown 2026-10-22, who
-- claimed a gift scoped to that occasion, has the claim auto-released on
-- 2026-09-15 -- 38 days before the date they were shown. The item is freed
-- and a duplicate gift invited, which is the exact failure claiming exists to
-- prevent, with no error raised anywhere.
--
-- RULING (final whole-branch review): the canonical partner's LIVE
-- profile_info date is authoritative for a partnered occasion. Three sources
-- disagreed; this makes them agree:
--
--   1. this function, and get_or_create_occasion after finding I1's fix
--      (20260912000015) -- both now derive a partnered row's date from the
--      canonical partner rather than from the celebrant the caller named;
--   2. get_upcoming_occasions' merged arm (20260912000011, guarded by
--      ...0013) already derives from user_a's date only -- unchanged, it
--      becomes consistent for free;
--   3. the confirmed card in components/profile/AnniversaryPartner.tsx,
--      which showed anniversary_links.agreed_date -- a request-time snapshot
--      that drifts after any edit -- and now shows the live date.
--
-- Rejected -- key the occasion off agreed_date: it would freeze the occasion
-- at confirm time, so a couple could never correct a genuinely wrong date.
-- Rejected -- leave it: it reaches the claim lifecycle, as above.
--
-- WHAT THIS DOES NOT CHANGE. The privacy gate below still runs against
-- p_celebrant_id -- the celebrant the CALLER asked about. A caller entitled
-- to act on the non-canonical partner's anniversary stays entitled to;
-- canonicalisation is an internal storage detail and must not become a reason
-- to refuse them. The canonical partner's date is read only AFTER that gate
-- has passed, and only to decide what date the couple's single shared row
-- carries.
--
-- Residual, accepted and stated rather than hidden: a viewer entitled to see
-- only the non-canonical partner's date now reads an occasion_date sourced
-- from the canonical partner's profile. confirm_anniversary_link writes the
-- agreed date to both partners' rows (20260912000012), so those two values
-- are equal at confirm time and diverge only through a post-confirm edit.
--
-- Fallback: if the canonical partner has no usable anniversary row, the
-- caller's own value is kept rather than raising. A partner can delete their
-- own date after confirming, and turning that into a hard refusal would break
-- tagging and claiming for a couple for whom both currently work.
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
  v_value  text;
  v_canon  text;
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

  v_value := v_row.field_value;

  -- Resolve a linked couple to ONE row. The privacy gate above has already run
  -- against the celebrant the CALLER named -- a caller entitled to act on Sam's
  -- anniversary stays entitled to, and which of the two ids the row is stored
  -- under is an internal detail that must not become a reason to refuse them.
  v_target  := p_celebrant_id;
  v_partner := null;

  if p_kind = 'anniversary' then
    -- ORDER BY: defense-in-depth only -- more than one confirmed link per
    -- person is unreachable through the RPCs today (anniversary_link_members'
    -- primary key plus anniversary_links_one_confirmed_a/_b), and an
    -- arbitrary planner-dependent pick is a worse failure mode than a
    -- deterministic one even for a state that should not occur.
    --
    -- v_target is always l.user_a -- the canonical, lexicographically smaller
    -- id -- never reversed. Reversing it would materialize
    -- celebrant_id = user_b / partner_id = user_a: a mirror row that
    -- unlink_anniversary's own `where celebrant_id = v_link.user_a and
    -- partner_id = v_link.user_b` could never find, stranding a stale
    -- partner_id after a breakup and leaving the occasions SELECT policy's
    -- partner branch admitting a viewer indefinitely.
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

  -- Finding I4: for a PARTNERED row, the canonical partner's live date is
  -- authoritative, so calls naming either partner land on the same date
  -- instead of overwriting each other. When the caller named the canonical
  -- partner already, v_value is that date and this does nothing. Read
  -- WITHOUT a second can_view_field gate on purpose: the gate above has
  -- already established the caller may act on this couple's anniversary, and
  -- re-gating on the storage id is exactly the "canonicalisation becomes a
  -- reason to refuse them" failure the resolution comment above rules out.
  if v_partner is not null and v_target is distinct from p_celebrant_id then
    select pi.field_value into v_canon
    from profile_info pi
    where pi.user_id = v_target
      and pi.category = 'dates'
      and pi.field_name = p_kind::text;

    if v_canon is not null then
      v_value := v_canon;
    end if;
  end if;

  v_date := public.celebration_date_in_year(v_value, v_year);
  if v_date is null then
    raise exception 'stored % is not a usable date', p_kind
      using errcode = '22023';
  end if;
  if v_date < current_date then
    v_date := public.celebration_date_in_year(v_value, v_year + 1);
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

comment on function
  public.get_or_create_celebrated_occasion(text, public.occasion_kind) is
  'Materializes the NAMED celebrant''s birthday/anniversary occasion, gated on can_view_field for that celebrant. Live body: 20260912000016_canonical_partner_date_authoritative.sql (superseding 20260911100000, ...0007, ...0008 and ...0010, whose own live-body pointers contradict each other). Resolves a confirmed anniversary link to one row under the canonical (user_a) partner, and takes a partnered occasion''s date from that canonical partner.';
