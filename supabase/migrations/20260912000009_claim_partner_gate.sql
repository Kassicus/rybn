-- =============================================================================
-- rybn: claim_wishlist_item must accept a PARTNER-visible occasion too
-- =============================================================================
--
-- CRITICAL, round-1 review. claim_wishlist_item's occasion gate
-- (20260911100002_claim_rpcs.sql) checks o.celebrant_id ONLY -- there is no
-- partner branch, unlike the occasions SELECT policy Task 2 widened
-- (20260912000002_occasion_partner.sql). Reproduced end-to-end: a confirmed
-- couple, canonical partner's anniversary visible to "family", non-canonical
-- partner's visible to "friends"; a gifter in the friends group only,
-- claiming an item tagged for the shared occasion, was REFUSED
-- ('that occasion is not available', 22023) even though that same gifter can
-- SEE the occasion (the widened SELECT policy admits them via its partner
-- branch) and can materialize it (get_or_create_celebrated_occasion's
-- can_view_field gate passes for the celebrant the caller can see). Against
-- the pre-Task-4 function body the same fixture succeeds, because before
-- Task 4 a couple never shared one row at all -- this bug is latent until a
-- couple's occasion is actually canonicalized, which is what this task
-- started doing for real.
--
-- THE FALSE PREMISE THIS CAME FROM. 20260912000002_occasion_partner.sql's
-- header (and the planning document's copy of it) states: "claim_wishlist_
-- item gates on the celebrant the caller named, not on the row's storage
-- id". That is backwards -- claim_wishlist_item takes no celebrant
-- parameter at all; its occasion gate reads directly from the row named by
-- p_occasion_id (o.celebrant_id, o.group_id), i.e. exactly the row's
-- storage id, with no partner branch. Task 2's SELECT-policy widening was
-- therefore necessary but not sufficient: it fixed READING a shared
-- occasion back, but nothing ever fixed CLAIMING one. Both copies of the
-- false sentence are corrected in place (with a `-- CORRECTED (20260912000009):`
-- marker, the same convention `803ce42` used) in
-- 20260912000002_occasion_partner.sql and
-- _planning/2026-09-11-shared-anniversaries-plan.md -- comment-only changes,
-- so no new migration is needed to fix either file's prose, and this one
-- migration is what actually fixes the LIVE behaviour.
--
-- THE FIX: a third `union all` arm, mirroring the SELECT policy's partner
-- branch exactly -- guarded on `o.partner_id is not null`, gating
-- can_view_field against the PARTNER's own profile_info row. The existing
-- two arms (celebrant-date, group-date) are kept byte-identical, and the
-- single shared `raise` at the end is unchanged, so this stays a
-- non-oracle: "not available" still means either "does not exist" or
-- "you cannot see it", now correctly covering the partner path too.
--
-- Tagging is unaffected by this bug and needs no fix: wishlist_item_
-- occasions' insert policy checks item ownership only, never the occasion's
-- privacy.
create or replace function public.claim_wishlist_item(
  p_item_id uuid,
  p_occasion_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_owner  text;
  v_privacy jsonb;
  v_purchased boolean;
  v_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select wi.user_id, wi.privacy_settings, wi.purchased
    into v_owner, v_privacy, v_purchased
  from wishlist_items wi where wi.id = p_item_id;

  -- One message for "no such item" and "you cannot see it", so this is not an
  -- existence oracle for other people's private items.
  if v_owner is null
     or not public.can_view_wishlist_item(v_owner, v_caller, v_privacy)
  then
    raise exception 'that item is not available to claim' using errcode = '22023';
  end if;

  if v_owner = v_caller then
    raise exception 'you cannot claim your own item' using errcode = '22023';
  end if;

  -- Purchase is terminal: a bought item accepts no new claims.
  if v_purchased then
    raise exception 'that item has already been purchased' using errcode = '22023';
  end if;

  -- The occasion, when given, must be one the caller can actually SEE -- not
  -- merely one that exists. This is SECURITY DEFINER, so `occasions`' own RLS
  -- does not apply here and the check has to be written out. An existence-only
  -- check would let any authenticated caller label a claim with any occasion
  -- id, including one belonging to somebody whose dates they cannot see --
  -- and since the occasion's date decides when the claim auto-releases, that
  -- is a forged label with real consequences, not a cosmetic one.
  --
  -- THREE shapes now, three gates, matching how the occasion itself is
  -- protected by the occasions SELECT policy: a celebrated occasion follows
  -- its CELEBRANT's own privacy settings for that date (can_view_field, the
  -- same gate get_upcoming_occasions uses); a linked couple's shared
  -- occasion ALSO follows its PARTNER's privacy settings for that date
  -- (added by this migration -- see the header for why this was missing);
  -- and a group_date follows group membership.
  --
  -- Note this is belt-and-braces in the normal flow: claimItem() calls
  -- get_or_create_celebrated_occasion() first, which already gates on
  -- can_view_field. But this function is granted to `authenticated` and so is
  -- reachable directly through PostgREST, where nothing upstream has run.
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
    -- Same message for "does not exist" and "you cannot see it", so this is
    -- not an existence oracle for other people's occasions.
    raise exception 'that occasion is not available' using errcode = '22023';
  end if;

  -- Release anything lapsed on this item before inserting. This is the step
  -- that makes "active is computed" and "one active claim" agree.
  update wishlist_claims c
     set released_at = now()
   where c.item_id = p_item_id
     and c.released_at is null
     and c.occasion_id is not null
     and exists (
       select 1 from occasions o
       where o.id = c.occasion_id and o.occasion_date < current_date
     );

  insert into wishlist_claims (item_id, occasion_id, claimed_by)
  values (p_item_id, p_occasion_id, v_caller)
  returning id into v_id;

  return v_id;
exception
  -- The unique index fired: somebody else holds a live claim. Report it as the
  -- product fact it is, not as a constraint name.
  when unique_violation then
    raise exception 'somebody has already claimed that item' using errcode = '22023';
end;
$$;

grant execute on function public.claim_wishlist_item(uuid, uuid) to authenticated, service_role;
