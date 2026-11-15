-- =============================================================================
-- rybn: the columns a signed-in person's client can select on user_profiles
--       and wishlist_items, and when an item's updated_at moves
-- =============================================================================
--
-- After this file, for a signed-in person's client (the role authenticated):
--
--   1. On user_profiles it can select id, username, display_name, avatar_url,
--      bio, created_at and updated_at, and no other column. A person reads
--      their own email and email_preferences through own_contact().
--   2. On wishlist_items it can select id, user_id, title, description, url,
--      price, image_url, priority, category, privacy_settings, created_at and
--      updated_at, and no other column. The marks on an item, whether it is
--      bought and who marked it out of stock, are read through
--      visible_item_marks(), which answers only for items the caller can see
--      and does not own.
--   3. It keeps insert, update and delete on both tables, and row-level
--      security decides which rows each reaches. The service role keeps every
--      privilege on both tables, and anon holds none; neither is changed here.
--   4. An item's updated_at is moved by update_wishlist_items_updated_at, to
--      now(), only when a statement writes one of the item's own eight
--      columns (title, description, url, price, image_url, priority, category,
--      privacy_settings), or updated_at itself: the owner's edit, and the
--      group-delete clean-up of privacy_settings. A giver's mark, and the
--      clearing of out_of_stock_marked_by when the marker's account is
--      deleted, leave it as it was.
--   5. A column added to either table later is selectable by authenticated
--      only once a migration grants it, and a column added to wishlist_items
--      later moves updated_at only once it is added to the trigger's column
--      list.
--
-- The privileges, the trigger and the tables' comments change in one do
-- block, so the file lands whole or not at all however the tool that applies
-- it runs it.
--
-- Apply after the code that reads through the two functions is deployed: from
-- then on, code that selects any other column of these tables with a
-- signed-in person's client, or asks for a whole row (select *, or a written
-- row back without naming its columns), is refused.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. The columns authenticated can select, the trigger, and the tables'
--    comments
-- -----------------------------------------------------------------------------
-- a. A table-level revoke of select also revokes every column-level select of
--    that kind, so the revoke comes first and the column grant after it.
--    insert, update and delete are not named, so they stay as they are.
-- b. The column list of update_wishlist_items_updated_at is the item's own
--    eight columns and updated_at itself: the trigger fires when one of them
--    is a target of the update, so a statement that names updated_at gets
--    now(). It runs update_updated_at_column(), which sets updated_at to
--    now(), and pin_wishlist_item_owner_fields sorts before it by name, so
--    the pin runs first.
do $$
begin
  revoke select on public.user_profiles from authenticated;
  grant select (id, username, display_name, avatar_url, bio, created_at, updated_at)
    on public.user_profiles to authenticated;

  revoke select on public.wishlist_items from authenticated;
  grant select (id, user_id, title, description, url, price, image_url, priority, category,
                privacy_settings, created_at, updated_at)
    on public.wishlist_items to authenticated;

  drop trigger update_wishlist_items_updated_at on public.wishlist_items;
  create trigger update_wishlist_items_updated_at
    before update of title, description, url, price, image_url, priority, category, privacy_settings, updated_at
    on public.wishlist_items
    for each row execute function public.update_updated_at_column();

  -- The tables' comments.
  comment on table public.user_profiles is
    'Identity root. id is the Clerk user id. Nothing references the Supabase auth schema. authenticated can select id, username, display_name, avatar_url, bio, created_at and updated_at; a person reads their own email and email_preferences through own_contact(). Column grants as of 20261115000001_private_columns.sql.';

  comment on table public.wishlist_items is
    'Wishlist items. Claims live in wishlist_claims as of 20260911100003; the "Users can claim visible wishlist items" policy now governs purchased/out_of_stock only, the marks a giver writes. authenticated can select id, user_id, title, description, url, price, image_url, priority, category, privacy_settings, created_at and updated_at; the marks are read through visible_item_marks(), which answers only for items the caller can see and does not own. updated_at moves, to now(), only when an update writes one of the eight columns title, description, url, price, image_url, priority, category and privacy_settings, or updated_at itself. Column grants and trigger as of 20261115000001_private_columns.sql.';
end $$;
