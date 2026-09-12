-- =============================================================================
-- rybn: make get_or_create_occasion() link-aware, and make a partnered
--       occasion's date come from the CANONICAL partner
-- =============================================================================
--
-- CORRECTIVE MIGRATION for 20260911000001_get_or_create_occasion_returning.sql
-- (the previous live body of this function), which already reached
-- production. That file is not edited in place -- a migration is the
-- historical record of what actually ran. This one supersedes its body with
-- `create or replace`.
--
-- THIS IS NOW THE LIVE BODY of get_or_create_occasion(public.occasion_kind).
--
-- -----------------------------------------------------------------------------
-- FINDING I1: the tagging path was never made link-aware.
-- -----------------------------------------------------------------------------
--
-- Task 4 taught get_or_create_celebrated_occasion to resolve a confirmed
-- anniversary link to ONE row under the canonical (lexicographically smaller)
-- partner. It did not teach get_or_create_occasion the same thing, on the
-- strength of a premise in the design document
-- (_planning/2026-09-11-shared-anniversaries-design.md, "Materialization")
-- that read: "Everything already funnels through this function -- phase 2's
-- celebrated tagging and phase 3's claimItem both call it."
--
-- Half of that is false, and this repository already documented it being
-- false. lib/actions/item-occasions.ts's tagItemForMyOccasion calls
-- get_or_create_occasion, NOT get_or_create_celebrated_occasion --
-- lib/occasions/taggable.ts's own doc comment says so in as many words
-- ("tagItemForMyOccasion() takes no celebrant argument at all"), because the
-- caller is always the celebrant there: you only tag your OWN items.
--
-- Consequence, reproduced on the live project through granted RPCs alone,
-- inside begin/rollback:
--
--   tag_occasion   (get_or_create_occasion as the non-canonical partner)
--     -> df18b187-...  celebrant_id = user_b, partner_id NULL
--   claim_occasion (get_or_create_celebrated_occasion as the canonical one)
--     -> eee8c4de-...  celebrant_id = user_a, partner_id = user_b
--   SAME ID? false        anniversary rows for the couple: 2
--
-- Two occasion rows for one couple is precisely the defect this whole feature
-- exists to remove: two claim scopes, two tag partitions, two ids carrying
-- identical "Alex & Sam's Anniversary" labels.
--
-- Fix: give this function the same couple resolution
-- get_or_create_celebrated_occasion already carries. It is the same block,
-- with v_caller standing in for p_celebrant_id -- this function has no
-- celebrant parameter, because the caller always IS the celebrant.
--
-- This had to ship together with the TypeScript half of finding I2 (every
-- "is this occasion this person's" check keying on celebrantId alone). Fixing
-- I2 first would make resolveTagTarget (lib/occasions/taggable.ts) start
-- returning { via: "my", kind: "anniversary" } for the NON-canonical
-- partner's own merged row, routing them straight into this
-- previously-unresolved function -- which would have taken the two-row bug
-- from "reachable when privacy narrows" to "fires for every couple, every
-- time".
--
-- -----------------------------------------------------------------------------
-- FINDING I4: a shared occasion's date was last-writer-wins.
-- -----------------------------------------------------------------------------
--
-- get_or_create_celebrated_occasion derives v_date from the celebrant the
-- CALLER named, then upserts under the canonical id with
-- `do update set occasion_date = excluded.occasion_date`. So two viewers
-- materializing the same shared row wrote two different dates to it.
-- Reproduced live, inside begin/rollback, with the two partners' profile
-- dates deliberately drifted:
--
--   A materializes (p_celebrant_id = user_a) -> row date 2026-10-22
--   B materializes (p_celebrant_id = user_b) -> SAME row, date 2026-09-14
--
-- That reaches the claim lifecycle, not just a label: release_lapsed_claims
-- (20260911100002_claim_rpcs.sql) releases every claim whose
-- `o.occasion_date < current_date`. A viewer who claimed a gift scoped to
-- 2026-10-22 has that claim auto-released on 2026-09-15 -- 38 days early,
-- freeing the item and inviting the duplicate gift claiming exists to
-- prevent. No error anywhere.
--
-- RULING (final whole-branch review): for a PARTNERED occasion, the canonical
-- partner's live profile_info date is authoritative. A caller naming either
-- partner -- or, here, a caller who IS either partner -- gets the same date.
-- get_upcoming_occasions' merged arm already derives from user_a's date only
-- (20260912000011/...0013), so this makes the three sources agree rather than
-- introducing a fourth opinion.
--
-- Rejected -- key the occasion off anniversary_links.agreed_date: that
-- freezes the occasion at confirm time, so a couple who agreed on a genuinely
-- wrong date could never correct it.
--
-- Rejected -- leave it: it is not cosmetic, it reaches auto-release.
--
-- Fallback, and why it exists: if the canonical partner has no usable
-- anniversary row of their own, this keeps the caller's own value rather than
-- raising. confirm_anniversary_link writes the agreed date to BOTH partners'
-- profile_info rows (20260912000012), so the canonical row is present for
-- every couple confirmed through the RPC -- but a partner can delete their
-- own date afterwards, and turning that into a hard refusal would break
-- tagging and claiming for a couple who currently have both working.
--
-- Residual, accepted and stated rather than hidden: after the couple confirm,
-- a partner who edits their own date can no longer move the shared occasion
-- unless they are the canonical half. That is the point -- one date, not a
-- race -- but it means a viewer entitled to see only the non-canonical
-- partner's date reads an occasion_date sourced from the canonical partner's.
-- Those two values are equal at confirm time and diverge only by a
-- post-confirm edit.
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
  v_canon   text;
  v_date    date;
  v_id      uuid;
  v_target  text;
  v_partner text;
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

  -- Finding I1. The same couple resolution get_or_create_celebrated_occasion
  -- carries (live body: this migration's sibling,
  -- 20260912000016_canonical_partner_date_authoritative.sql), with v_caller
  -- in place of p_celebrant_id: this function has no celebrant parameter
  -- because the caller always IS the celebrant. Without it, tagging an item
  -- from the non-canonical partner's own list created a SECOND occasion row
  -- for a couple that claiming had already merged into one.
  --
  -- v_target is always l.user_a -- the canonical, lexicographically smaller
  -- id -- never reversed. A mirror row (celebrant_id = user_b,
  -- partner_id = user_a) would be invisible to unlink_anniversary's own
  -- `where celebrant_id = v_link.user_a and partner_id = v_link.user_b`
  -- scoping, stranding a stale partner_id after a breakup and leaving the
  -- partner branch of the occasions SELECT policy admitting a viewer
  -- indefinitely.
  --
  -- `order by l.id` is defense-in-depth, exactly as in the sibling function:
  -- at most one confirmed link per person is reachable through the RPCs
  -- today (anniversary_link_members' primary key plus
  -- anniversary_links_one_confirmed_a/_b), so a deterministic tiebreak is
  -- guarding a state that should not occur rather than one that does.
  v_target  := v_caller;
  v_partner := null;

  if p_kind = 'anniversary' then
    select l.user_b, l.user_a
      into v_partner, v_target
      from public.anniversary_links l
     where l.status = 'confirmed'
       and v_caller in (l.user_a, l.user_b)
     order by l.id
     limit 1;

    if v_target is null then
      v_target  := v_caller;
      v_partner := null;
    end if;
  end if;

  -- Finding I4. For a PARTNERED row the canonical partner's live
  -- profile_info date is authoritative, so a call by either partner lands on
  -- the same date rather than whichever of them touched the row last. When
  -- the caller already IS the canonical partner, v_value is that date
  -- already and this does nothing. See the header for the ruling, the
  -- reproduction, and why the fallback keeps the caller's own value instead
  -- of raising when the canonical partner has no row.
  if v_partner is not null and v_target is distinct from v_caller then
    select pi.field_value into v_canon
    from profile_info pi
    where pi.user_id = v_target
      and pi.category = 'dates'
      and pi.field_name = p_kind::text;

    if v_canon is not null then
      v_value := v_canon;
    end if;
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

  -- do update, not do nothing: RETURNING then fires on every path (a fresh
  -- insert, or the resolved celebrant's pre-existing row for this
  -- kind/year), which removes the separate readback -- and its snapshot race
  -- -- entirely, and refreshes occasion_date when the stored date has since
  -- changed. partner_id is written and refreshed alongside it, so a couple's
  -- row reaches the same shape whether tagging or claiming materialized it
  -- first; before this migration this insert named no partner_id at all and
  -- a tag-first couple got an unmerged row.
  insert into public.occasions (kind, celebrant_id, partner_id, occasion_date, created_by)
  values (p_kind, v_target, v_partner, v_date, v_caller)
  on conflict (kind, celebrant_id, occasion_year) where celebrant_id is not null
  do update set occasion_date = excluded.occasion_date,
                partner_id    = excluded.partner_id
  returning id into v_id;

  -- Should be unreachable: RETURNING now always produces a row on this path.
  -- Kept as a backstop because an unreachable check costs nothing and a
  -- reachable one would mean the analysis above was wrong.
  if v_id is null then
    raise exception 'get_or_create_occasion failed to materialize an occasion for % (%)',
      v_caller, p_kind
      using errcode = '22023';
  end if;

  return v_id;
end;
$$;

grant execute on function public.get_or_create_occasion(public.occasion_kind)
  to authenticated, service_role;

-- A durable pointer to the live body, readable from the database itself
-- (\df+ / obj_description) rather than only from whichever migration file a
-- reader happens to open. Migration headers cannot be kept current without
-- editing applied migrations in place, which is what produced finding M1
-- (a correction that reached the file and never reached the database).
comment on function public.get_or_create_occasion(public.occasion_kind) is
  'Materializes the CALLER''s own birthday/anniversary occasion. Live body: 20260912000015_link_aware_get_or_create_occasion.sql. Resolves a confirmed anniversary link to one row under the canonical (user_a) partner, and takes a partnered occasion''s date from that canonical partner.';
