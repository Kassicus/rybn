-- =============================================================================
-- rybn: move claims off wishlist_items
-- =============================================================================
--
-- Backfill first, then drop. The backfill is a no-op today (production held 0
-- claimed items when this was written, verified in the step above) but it is
-- written correctly anyway: if this ever runs against a database that does
-- have claims, they survive as UNSCOPED claims -- occasion_id null, which by
-- claim_wishlist_item()'s rule never auto-releases. That preserves today's
-- behaviour exactly for claims made before occasions existed.
insert into public.wishlist_claims (item_id, occasion_id, claimed_by, claimed_at)
select wi.id, null, wi.claimed_by, coalesce(wi.claimed_at, now())
from public.wishlist_items wi
where wi.claimed_by is not null;

-- The trigger's permitted-column list is the contract for what a NON-owner may
-- change on somebody else's item. claimed_by/claimed_at are leaving the table,
-- so they leave the list; purchased, out_of_stock and updated_at stay, because
-- a non-owner still writes those.
--
-- supabase/tests/rls/09_privacy_pins.sql asserts this trigger definition as an
-- exact string and is updated in the same commit. A migration that changes a
-- pinned contract without updating its assertion is how the assertion quietly
-- stops meaning anything.
drop trigger if exists pin_wishlist_item_owner_fields on public.wishlist_items;

create trigger pin_wishlist_item_owner_fields
  before update on public.wishlist_items
  for each row execute function public.reject_non_owner_column_change(
    'purchased', 'purchased_at',
    'out_of_stock_marked_by', 'out_of_stock_marked_at', 'updated_at');

-- "Users can claim visible wishlist items" STAYS. Its name is now slightly
-- wrong -- it no longer governs claiming -- but it is what still lets a
-- non-owner mark an item purchased or out of stock, and renaming a policy
-- means dropping and recreating it for no behavioural gain.
comment on table public.wishlist_items is
  'Wishlist items. Claims live in wishlist_claims as of 20260911100003; the "Users can claim visible wishlist items" policy now governs purchased/out_of_stock only.';

drop index if exists public.idx_wishlist_items_claimed_by;

alter table public.wishlist_items drop column claimed_by;
alter table public.wishlist_items drop column claimed_at;
