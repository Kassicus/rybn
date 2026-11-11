-- =============================================================================
-- rybn: tie a tracked gift to the claim, person and occasion it belongs to
--       (rybn-mobile docs/2026-11-11-mobile-shopping-design.md §7)
-- =============================================================================
--
-- The iPhone app makes claiming and tracking one thing. Today a claim
-- (wishlist_claims) and a tracked gift (tracked_gifts) are separate rows with
-- nothing between them, and a gift recipient is a typed name. This adds:
--
--   1. four columns, and the indexes that keep one recipient per person and
--      one gift per item for each giver;
--   2. set_claim_occasion(), the only way to change the occasion of a claim
--      the caller holds (nothing could before);
--   3. the privacy fix D14: get_or_create_celebrated_occasion() stops
--      recording which giver created someone else's birthday or anniversary
--      row, and what it recorded is cleared. Otherwise the celebrant can read
--      who claimed something for them with their own database token.
--
-- ADDITIVE apart from (3). Nothing on the site reads or writes the new
-- columns, so this is safe to apply before the routes that use them are
-- merged. Existing rows: every new column starts null (or false), so neither
-- unique index can be violated by data already present and no foreign key is
-- checked against an existing value.
--
-- (3) was checked before it was written. No TypeScript reads
-- occasions.created_by: lib/actions/occasions.ts only writes it, for group
-- dates. Every policy that reads it is guarded by kind = 'group_date'
-- (20260910100001_occasions_schema_policy_fix.sql:106-150). Group dates keep
-- theirs, because the creator-or-admin edit rule depends on it. From now on,
-- rows the celebrant or their partner create for themselves
-- (get_or_create_occasion, confirm_anniversary_link) go on recording that
-- person, which tells nobody anything about a gift; the clean-up at the end
-- clears every existing birthday and anniversary row, theirs included.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Columns and indexes
-- -----------------------------------------------------------------------------

-- The person a recipient stands for. A recipient the giver typed keeps null.
alter table public.gift_recipients
  add column person_id text references public.user_profiles(id) on delete set null;

-- The item a gift came from; whether it came from someone's list at all,
-- which stays true after the item is deleted and wishlist_item_id goes null
-- (that is how the app can say the item has gone); and the occasion it is
-- filed under.
alter table public.tracked_gifts
  add column wishlist_item_id uuid references public.wishlist_items(id) on delete set null,
  add column from_list boolean not null default false,
  add column occasion_id uuid references public.occasions(id) on delete set null;

-- One recipient per person, and one gift per item, for each giver. Partial,
-- so typed recipients and hand-added gifts stay unconstrained, as today. The
-- referenced column leads, so the on-delete actions find their rows by index.
-- They are also the race backstop: two screens filing the same claim at once
-- cannot make two gifts.
create unique index gift_recipients_one_per_person
  on public.gift_recipients (person_id, user_id)
  where person_id is not null;

create unique index tracked_gifts_one_per_item
  on public.tracked_gifts (wishlist_item_id, user_id)
  where wishlist_item_id is not null;

create index tracked_gifts_by_occasion
  on public.tracked_gifts (occasion_id)
  where occasion_id is not null;


-- -----------------------------------------------------------------------------
-- 2. Moving a held claim to another occasion
--
-- For a gift from a list the claim's occasion is the truth and the gift's
-- copy follows it (design D12), so changing a gift's occasion changes its
-- claim's. Only the caller's own claim, and only while it is still held:
-- not released and not lapsed, by the rule lib/claims/active.ts states and
-- claim_wishlist_item's lapsed-release applies. Only on an item the caller
-- can still see, as claiming requires: without that, someone who has left
-- the group could move a dated claim to no occasion and hold the item for
-- good. The new occasion passes the same "can you see this occasion" gate
-- claiming uses. Whether the occasion involves the item's owner is checked
-- by the mobile API (design §5.1), not here: the database does not enforce it.
-- -----------------------------------------------------------------------------
create or replace function public.set_claim_occasion(
  p_item_id uuid,
  p_occasion_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_claim  uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- A lapsed claim is the next claimer's to release, not this caller's to
  -- move: moving it to a later occasion would revive it. An item the caller
  -- can no longer see is not theirs to move either. One message for all of
  -- these, so this is not an existence oracle.
  select c.id into v_claim
    from wishlist_claims c
    join wishlist_items wi on wi.id = c.item_id
   where c.item_id = p_item_id
     and c.claimed_by = v_caller
     and c.released_at is null
     and public.can_view_wishlist_item(wi.user_id, v_caller, wi.privacy_settings)
     and (wi.purchased
          or c.occasion_id is null
          or not exists (
            select 1 from occasions o
             where o.id = c.occasion_id and o.occasion_date < current_date
          ))
   for update of c;

  if v_claim is null then
    raise exception 'you no longer hold that item' using errcode = '22023';
  end if;

  -- The three arms below are claim_wishlist_item's, byte for byte
  -- (20260912000009_claim_partner_gate.sql): a celebrant arm, a partner arm
  -- and a group arm. One message whether the occasion does not exist or the
  -- caller cannot see it, so this is not an existence oracle.
  if p_occasion_id is not null and not exists (
    select 1 from occasions o
     where o.id = p_occasion_id
       and o.celebrant_id is not null
       and exists (
         select 1 from profile_info pi
          where pi.user_id = o.celebrant_id
            and pi.category = 'dates'
            and pi.field_name = o.kind::text
            and public.can_view_field(o.celebrant_id, v_caller, pi.privacy_settings)
       )
    union all
    select 1 from occasions o
     where o.id = p_occasion_id
       and o.partner_id is not null
       and exists (
         select 1 from profile_info pi
          where pi.user_id = o.partner_id
            and pi.category = 'dates'
            and pi.field_name = o.kind::text
            and public.can_view_field(o.partner_id, v_caller, pi.privacy_settings)
       )
    union all
    select 1 from occasions o
     where o.id = p_occasion_id
       and o.group_id is not null
       and public.is_group_member(o.group_id, v_caller)
  ) then
    raise exception 'that occasion is not available' using errcode = '22023';
  end if;

  update wishlist_claims
     set occasion_id = p_occasion_id
   where id = v_claim;
end;
$$;

-- The baseline's default privileges already keep anon out of new functions.
-- The revoke says so again, so nobody has to know that; the grant is
-- re-stated as the claim RPCs' own grants are.
revoke execute on function public.set_claim_occasion(uuid, uuid) from public, anon;
grant execute on function public.set_claim_occasion(uuid, uuid) to authenticated, service_role;

comment on function public.set_claim_occasion(uuid, uuid) is
  'Moves the CALLER''s own held claim on p_item_id, an item the caller can still see, to p_occasion_id (or to none). Same occasion gate as claim_wishlist_item. Raises 22023 ''you no longer hold that item'' or ''that occasion is not available''. Live body: 20261111000000_shopping_links.sql.';


-- -----------------------------------------------------------------------------
-- 3. D14: a giver who materializes someone else's birthday or anniversary is
--    no longer recorded on it, and what was recorded is cleared.
-- -----------------------------------------------------------------------------
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

  insert into public.occasions (kind, celebrant_id, partner_id, occasion_date)
  values (p_kind, v_target, v_partner, v_date)
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
  'Materializes the NAMED celebrant''s birthday/anniversary occasion, gated on can_view_field for that celebrant. Live body: 20261111000000_shopping_links.sql (superseding 20260912000016, which superseded 20260911100000, ...0007, ...0008 and ...0010). Resolves a confirmed anniversary link to one row under the canonical (user_a) partner, and takes a partnered occasion''s date from that canonical partner. Records no creator: the caller is usually a giver, and the celebrant can read the row.';

update public.occasions
   set created_by = null
 where kind in ('birthday', 'anniversary')
   and created_by is not null;
