-- =============================================================================
-- rybn: claiming, with lapsed claims self-healing on write
-- =============================================================================
--
-- A claim is ACTIVE when released_at is null AND (occasion_id is null OR the
-- occasion has not passed). Reads use that definition directly, so a lapsed
-- claim never renders as live.
--
-- Writes cannot: wishlist_claims_one_active only sees `released_at is null`,
-- so a lapsed row would block a new claim forever. This function therefore
-- releases lapsed claims on the item FIRST, then inserts -- both in one
-- transaction, with the unique index as the race backstop. That is why no
-- release cron exists and none is needed.
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
  -- Two shapes, two gates, matching how the occasion itself is protected:
  -- a celebrated occasion follows its celebrant's own privacy settings for
  -- that date (can_view_field, the same gate get_upcoming_occasions uses), and
  -- a group_date follows group membership.
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

-- Releasing your own claim. Returns false when there was nothing to release,
-- rather than raising -- an unclaim that finds nothing is not an error.
create or replace function public.release_wishlist_claim(p_item_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller text := (select public.requesting_user_id());
  v_count integer;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  update wishlist_claims
     set released_at = now()
   where item_id = p_item_id
     and claimed_by = v_caller
     and released_at is null;

  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;

grant execute on function public.claim_wishlist_item(uuid, uuid) to authenticated, service_role;
grant execute on function public.release_wishlist_claim(uuid) to authenticated, service_role;
