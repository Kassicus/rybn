-- =============================================================================
-- rybn: claims, scoped to the occasion they were made for
-- =============================================================================
--
-- ONE ACTIVE CLAIM PER ITEM, not one per occasion. If exclusion were
-- per-occasion, the same headphones could be claimed for Mom's birthday by one
-- person and for Christmas by another at the same time -- two people buying
-- the same thing, which is the exact failure claiming exists to prevent. The
-- occasion LABELS the claim and decides when it lapses; it does not partition
-- the exclusion.
--
-- OWNER-BLINDNESS IS ENFORCED HERE, not in application code. Until this
-- migration, getMyWishlist() stripped six columns before returning
-- (lib/actions/wishlist.ts) -- correct, but a rule a future caller can forget.
-- A separate table lets RLS say it instead: the item's owner is excluded from
-- the SELECT policy, so there is no query they can write that returns their
-- own items' claims. The surprise is the product; make it structural.
create table public.wishlist_claims (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.wishlist_items(id) on delete cascade,
  -- on delete SET NULL, not cascade: deleting an occasion must not destroy the
  -- record of who claimed what. The claim survives as an unscoped one, which
  -- by the rule below simply never auto-releases.
  occasion_id uuid references public.occasions(id) on delete set null,
  claimed_by text not null references public.user_profiles(id) on delete cascade,
  claimed_at timestamptz not null default now(),
  released_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.wishlist_claims is
  'One active claim per item, labelled with the occasion it was made for. Never readable by the item''s owner.';

-- The race backstop. Active-ness is computed on read (released_at is null AND
-- the occasion has not passed), but an index cannot see another table or
-- current_date -- so this enforces the weaker invariant and claim_wishlist_item()
-- closes the gap by releasing lapsed claims before it inserts.
create unique index wishlist_claims_one_active
  on public.wishlist_claims (item_id) where released_at is null;

create index wishlist_claims_by_claimer
  on public.wishlist_claims (claimed_by) where released_at is null;

alter table public.wishlist_claims enable row level security;

-- Readable by anyone who can see the item EXCEPT its owner. The owner
-- exclusion is the whole point: see the header.
create policy "Claims are visible to everyone but the item's owner"
  on public.wishlist_claims for select to authenticated
  using (
    exists (
      select 1 from public.wishlist_items wi
      where wi.id = wishlist_claims.item_id
        and wi.user_id <> (select public.requesting_user_id())
        and public.can_view_wishlist_item(
          wi.user_id, (select public.requesting_user_id()), wi.privacy_settings)
    )
  );

-- Writes go through claim_wishlist_item() / release_wishlist_claim(), which are
-- SECURITY DEFINER (Task 3). No INSERT or UPDATE policy exists, deliberately:
-- a direct insert could not perform the lapsed-claim release the unique index
-- requires, so it would fail confusingly rather than safely. Absent a policy,
-- direct writes fail closed.

grant select on public.wishlist_claims to authenticated;
grant select, insert, update on public.wishlist_claims to service_role;

-- Supabase's per-role default privileges (set at project provisioning, not
-- undone for `authenticated` by clerk_native_baseline.sql:1997-1999 the way
-- they are for `anon`) grant every DML verb to `authenticated` on any NEW
-- table, regardless of what this migration's own GRANT line above says.
-- Confirmed directly against this project: wishlist_item_occasions's own
-- migration (20260911000002) grants authenticated only select/insert/delete,
-- yet `authenticated` holds UPDATE on that table too, live. Left alone, the
-- same thing would happen here and the `grant select` line above would be
-- purely decorative -- `authenticated` would still hold INSERT/UPDATE/DELETE
-- at the privilege layer, with only the (correct, but singular) RLS layer
-- standing between it and a write. Revoked explicitly so SELECT-only is true
-- at BOTH layers -- the privilege grant and the policy set -- matching what
-- 16_claim_visibility.sql's has_table_privilege() checks assert.
revoke insert, update, delete on public.wishlist_claims from authenticated;
