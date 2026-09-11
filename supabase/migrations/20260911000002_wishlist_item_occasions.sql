-- =============================================================================
-- rybn: which occasions an item was meant for
-- =============================================================================
--
-- A tag is the OWNER'S statement of intent. Only the owner writes one --
-- letting a viewer tag somebody else's item would put words in their mouth,
-- and the item would then render to everyone else as if the owner had said it.
--
-- Reading a tag is gated by the ITEM's visibility, not the occasion's: a tag
-- reveals "this person wants this for their birthday", which is a fact about
-- the item. can_view_wishlist_item() is therefore the right gate, and reusing
-- it means a tag can never be visible where its item is not.
--
-- ON DELETE CASCADE on both foreign keys is deliberate, including the
-- indirect untag path it opens: referential actions run RLS-suspended, and a
-- group_date occasion is deletable by any group admin, so deleting a shared
-- occasion silently removes every OTHER user's tags pointing at it too. That
-- is judged acceptable, not overlooked -- the occasion no longer exists, so a
-- tag naming it is meaningless, and nothing here lets one user assert or
-- retract another user's stated intent -- but it is a real side effect.
create table public.wishlist_item_occasions (
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  occasion_id uuid not null references public.occasions(id) on delete cascade,
  created_at timestamptz default now(),
  primary key (item_id, occasion_id)
);

comment on table public.wishlist_item_occasions is
  'Owner-asserted link between a wishlist item and an occasion it is meant for. Read gated by the item''s visibility.';

-- Serves "which items are tagged for this occasion" -- the reverse lookup.
-- Lookups the OTHER way ("the tags on this item") are already served by the
-- primary key's leading column and need no index of their own.
create index wishlist_item_occasions_by_occasion
  on public.wishlist_item_occasions (occasion_id);

alter table public.wishlist_item_occasions enable row level security;

create policy "Tags are visible wherever their item is"
  on public.wishlist_item_occasions for select to authenticated
  using (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_item_occasions.item_id
        -- Defence in depth, not the only thing standing here: this EXISTS
        -- subquery is itself subject to wishlist_items' own RLS, and that
        -- table's two SELECT policies (clerk_native_baseline.sql:1573-1583)
        -- already union to exactly "own item OR can_view_wishlist_item(...)"
        -- -- the identical shape of the conjunct below. So this policy would
        -- still do the right thing even with no visibility check of its own,
        -- purely by inheriting wishlist_items' own filtering. The explicit
        -- call is deliberate belt-and-suspenders against a future loosening
        -- of that upstream policy; 14_tag_visibility.sql's read assertions
        -- cannot tell which of the two layers is actually holding the line.
        and public.can_view_wishlist_item(
          wi.user_id, (select public.requesting_user_id()), wi.privacy_settings)
    )
  );

create policy "Owners tag their own items"
  on public.wishlist_item_occasions for insert to authenticated
  with check (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_item_occasions.item_id
        and wi.user_id = (select public.requesting_user_id())
    )
  );

create policy "Owners untag their own items"
  on public.wishlist_item_occasions for delete to authenticated
  using (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_item_occasions.item_id
        and wi.user_id = (select public.requesting_user_id())
    )
  );

-- No UPDATE policy, deliberately: a tag has no mutable field. Changing which
-- occasion an item is for is a delete plus an insert, both of which the
-- policies above already gate. A tag that could be updated in place would need
-- a WITH CHECK that re-tested ownership of the NEW item_id -- the same shape of
-- hole the occasions UPDATE policy shipped with in phase 1.

grant select, insert, delete on public.wishlist_item_occasions to authenticated;
grant select, insert, delete on public.wishlist_item_occasions to service_role;
