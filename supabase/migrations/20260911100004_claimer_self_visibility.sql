-- =============================================================================
-- rybn: let a claimer see their own claim after losing sight of the item
-- =============================================================================
--
-- wishlist_claims' SELECT policy admitted a row only through an EXISTS over
-- wishlist_items -- and that subquery is itself subject to wishlist_items' RLS
-- for the querying role. Verified directly against this project rather than
-- assumed: impersonating a user who cannot see the one live item,
--     exists (select 1 from wishlist_items wi where wi.id = <item>)  ->  false
-- So once a claimer loses visibility of an item -- they leave the shared group,
-- or the owner narrows privacy_settings -- the EXISTS stops matching and they
-- go blind to their OWN claim. The claim itself survives, which is correct; the
-- claimer's ability to see it should not have depended on the item.
--
-- For an occasion-scoped claim this self-heals when the occasion passes. For an
-- UNSCOPED claim, which never auto-releases, the item stays held by somebody who
-- can neither see it nor release it from the UI.
--
-- WHY THE OBVIOUS FIX DOES NOT WORK. Adding `or claimed_by = requesting_user_id()`
-- INSIDE the existing EXISTS changes nothing: the EXISTS has already failed,
-- because the wishlist_items row is invisible. The new branch has to be a
-- TOP-LEVEL disjunct that never reads wishlist_items as the caller.
--
-- WHY THAT NEEDS A DEFINER HELPER. Owner-blindness is this product's core
-- privacy promise and 20260911100001 deliberately made it structural rather
-- than a rule application code remembers. A bare `claimed_by =
-- requesting_user_id()` disjunct would re-open it for any row where the item's
-- owner is also its claimer. No such row can exist today -- claim_wishlist_item()
-- raises 'you cannot claim your own item', and `authenticated` holds no INSERT
-- privilege on this table -- but that is an invariant maintained elsewhere,
-- which is exactly what moving owner-blindness into RLS was meant to stop
-- relying on. owns_wishlist_item() keeps the guarantee inside the policy.
--
-- It is not an ownership oracle: it takes no viewer parameter, pins to
-- requesting_user_id(), and so only ever answers "do I own this", which the
-- caller already knows.
create or replace function public.owns_wishlist_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.wishlist_items wi
    where wi.id = p_item_id
      and wi.user_id = (select public.requesting_user_id())
  );
$$;

comment on function public.owns_wishlist_item(uuid) is
  'Whether the CALLING user owns the given wishlist item. Pinned to requesting_user_id(); takes no viewer parameter, so it answers only about the caller.';

grant execute on function public.owns_wishlist_item(uuid) to authenticated, service_role;

-- Replaced rather than renamed: 16_claim_visibility.sql asserts that exactly
-- ONE permissive SELECT policy exists on this table, and Postgres ORs multiple
-- permissive policies for the same command together -- so adding a second
-- policy for the new branch would both trip that assertion and widen access by
-- a mechanism no expression-text check could see.
drop policy "Claims are visible to everyone but the item's owner"
  on public.wishlist_claims;

create policy "Claims are visible to everyone but the item's owner"
  on public.wishlist_claims for select to authenticated
  using (
    -- Your own claim, whether or not you can still see the item. The
    -- owns_wishlist_item() conjunct is what keeps owner-blindness structural
    -- on this branch: it is the only thing standing between an item's owner
    -- and a claim row that names them as the claimer.
    (
      wishlist_claims.claimed_by = (select public.requesting_user_id())
      and not public.owns_wishlist_item(wishlist_claims.item_id)
    )
    -- Everyone else who can see the item, owner still excluded. Unchanged.
    or exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_claims.item_id
        and wi.user_id <> (select public.requesting_user_id())
        and public.can_view_wishlist_item(
          wi.user_id, (select public.requesting_user_id()), wi.privacy_settings)
    )
  );
