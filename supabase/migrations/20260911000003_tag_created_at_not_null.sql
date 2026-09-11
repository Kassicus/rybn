-- =============================================================================
-- rybn: close the wishlist_item_occasions.created_at null hole
-- =============================================================================
--
-- created_at had a DEFAULT but was nullable, and the table-wide INSERT grant
-- lets any authenticated client name every column PostgREST exposes -- a
-- client can send {"created_at": null} explicitly, and DEFAULT never fires
-- for an explicit NULL, only for an OMITTED column. NOT NULL closes that.
--
-- It does not stop a forged NON-null timestamp (e.g. backdating a tag) --
-- that is a real, separate gap, left open deliberately: nothing reads
-- created_at for any access-control decision today, so it is a display-only
-- concern, out of scope for this fix.
--
-- Safe to apply unconditionally: this table was created in
-- 20260911000002_wishlist_item_occasions.sql, in this same phase, and
-- nothing has written to it outside rolled-back RLS test fixtures, so there
-- are no existing NULL values for this constraint to trip over.
alter table public.wishlist_item_occasions
  alter column created_at set not null;
