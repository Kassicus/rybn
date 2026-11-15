-- =============================================================================
-- rybn: a person's own contact details, and the marks on items they may see
-- =============================================================================
--
-- Two functions, each answering the caller alone:
--
--   1. own_contact(), SECURITY DEFINER, with no argument: the caller's own
--      email and email_preferences from user_profiles. One row, or none when
--      the caller has no profile. It takes no argument, so it only ever
--      answers about the caller.
--   2. visible_item_marks(p_item_ids uuid[]), SECURITY DEFINER: for each item
--      in the list that the caller can see and does not own, whether it is
--      bought (purchased, false when unset) and who marked it out of stock
--      (out_of_stock_marked_by). The caller sees an item on the terms of the
--      policy "Users can view wishlist items based on privacy": they are
--      signed in, they are not its owner, and can_view_wishlist_item() is
--      true with them as the viewer. Only an item that carries a mark (bought,
--      or marked out of stock) is answered. An item the caller owns, an item
--      they cannot see and an item with no mark get no row, and so does an
--      empty or null list.
--   Each is executable by authenticated alone.
--
-- Safe to apply before the code that calls it: it adds two functions nothing
-- on the site calls yet, and changes no table, policy or existing grant.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The caller's own contact details
-- -----------------------------------------------------------------------------
-- The caller is requesting_user_id(), as in every policy. Running as its
-- owner, the function reads the caller's row by its id and nothing else.
create or replace function public.own_contact()
returns table (email text, email_preferences jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select up.email, up.email_preferences
    from user_profiles up
   where up.id = (select public.requesting_user_id());
$$;

revoke execute on function public.own_contact() from public, anon, service_role;
grant execute on function public.own_contact() to authenticated;

comment on function public.own_contact() is
  'The caller''s own email and email_preferences from user_profiles: one row, or none when the caller has no profile. Security definer, no argument, so it answers only about the caller. Executable by authenticated alone. Added by 20261115000000_own_contact_and_item_marks.sql.';


-- -----------------------------------------------------------------------------
-- 2. The marks on items the caller may see
-- -----------------------------------------------------------------------------
-- Running as its owner, the function reads each listed item and answers it
-- only on the three conditions of the policy "Users can view wishlist items
-- based on privacy", the caller standing as the viewer: signed in, not the
-- item's owner, and can_view_wishlist_item(owner, caller, privacy_settings).
-- So a giver is answered for exactly the items that policy lets them see, and
-- an item's owner is answered nothing about it. Of those, only items that are
-- bought or marked out of stock are answered; purchased reads false when it
-- is unset.
create or replace function public.visible_item_marks(p_item_ids uuid[])
returns table (item_id uuid, purchased boolean, out_of_stock_marked_by text)
language sql
stable
security definer
set search_path = public
as $$
  select wi.id, coalesce(wi.purchased, false), wi.out_of_stock_marked_by
    from wishlist_items wi
   where wi.id = any (p_item_ids)
     and (select public.requesting_user_id()) is not null
     and wi.user_id <> (select public.requesting_user_id())
     and public.can_view_wishlist_item(
           wi.user_id, (select public.requesting_user_id()), wi.privacy_settings)
     and (coalesce(wi.purchased, false) or wi.out_of_stock_marked_by is not null);
$$;

revoke execute on function public.visible_item_marks(uuid[]) from public, anon, service_role;
grant execute on function public.visible_item_marks(uuid[]) to authenticated;

comment on function public.visible_item_marks(uuid[]) is
  'For each listed item the caller can see and does not own (the three conditions of the policy "Users can view wishlist items based on privacy", the caller as the viewer), whether it is bought (false when unset) and who marked it out of stock. Only items that are bought or marked out of stock are answered; an item''s owner is answered nothing about it, and an empty or null list gets no row. Security definer, pinned to requesting_user_id(). Executable by authenticated alone. Added by 20261115000000_own_contact_and_item_marks.sql.';
