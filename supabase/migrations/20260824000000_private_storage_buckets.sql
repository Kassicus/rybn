-- =============================================================================
-- rybn: both image buckets become PRIVATE, and storage.objects stops being
--       readable by PUBLIC
-- =============================================================================
--
-- The baseline created `wishlist-images` and `gift-photos` with `public = true`
-- and gave storage.objects two SELECT policies `to public`:
--
--     create policy "Public read access for wishlist images"
--       on storage.objects for select to public
--       using (bucket_id = 'wishlist-images');
--
-- That is two separate doors, and both are open to anyone:
--
--   1. `public = true` on the BUCKET makes /storage/v1/object/public/<bucket>/…
--      serve the bytes with no token and no session at all.
--   2. `to public` on the POLICY makes the row itself visible to the `anon`
--      role, because PUBLIC includes anon.
--
-- This app exists to keep gifts secret. A wishlist item can be restricted to
-- one group; a tracked gift is private to the person buying it. Its IMAGE was
-- readable by anyone who came into possession of the URL -- and image URLs
-- leak by design: Referer headers, link previews, a pasted "look at this",
-- browser history on a shared machine. The failure is silent and it spoils
-- exactly the surprise the feature is for.
--
-- WHAT REPLACES IT
-- ----------------
-- The buckets go private and the `to public` SELECT policies are replaced with
-- owner-scoped ones, matching the INSERT/UPDATE/DELETE policies that were
-- already folder-scoped and are left untouched:
--
--     (storage.foldername(name))[1] = (select public.requesting_user_id())
--
-- So a signed-in user can list and manage their OWN objects, and nobody can
-- read anyone else's row.
--
-- That deliberately leaves NO database-level path by which a viewer reads the
-- image on someone else's wishlist item -- because there is no honest one. The
-- question "may this viewer see this image" is really "may this viewer see the
-- wishlist ITEM it belongs to", which is a privacy_settings lookup across group
-- membership. storage.objects holds none of that. A policy could only infer it
-- from the object's path, and a path convention is not an authorisation model:
-- the first time someone renames a file or copies an object, the convention and
-- the permission part company silently.
--
-- So the decision is made where it can actually be evaluated. The server action
-- reads the row under RLS -- which either returns it or does not -- and only
-- then mints a short-lived signed URL for the image (lib/supabase/signed-image.ts).
-- The service-role key signs; it never decides. A signed URL is handed out
-- exactly when the caller had already been authorised for the underlying item.
--
-- The application half of this change:
--   - components/ui/image-input.tsx stores `data.path` instead of a public URL,
--     because a private bucket has no public URL to store.
--   - the wishlist and gift-tracking actions sign that path on the way out.
--   - a row may only ever NAME a path inside its own author's folder
--     (isOwnedStoragePath, lib/storage/image-value.ts). Signing bypasses RLS, so
--     without that check a user could point their own item at a stranger's
--     object path and have the server re-publish it.
--
-- NO BACKFILL. Every table is empty and storage.objects holds zero rows, so
-- there is no stored public URL to convert. This is the cheapest moment this
-- change will ever have.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. The premise, asserted rather than assumed.
--
-- Everything below is safe to run WITHOUT a backfill only because no row holds
-- a legacy public URL. That is true of this project today -- 14 tables, 0 rows
-- -- and it is exactly why this is the cheapest moment for the change. But the
-- rest of this file asserts its own end state four different ways and would be
-- checking the premise nowhere, and a migration that is correct only under an
-- unstated precondition is a migration that silently does damage the first time
-- someone applies it somewhere else.
--
-- What the damage looks like: a stored `https://<ref>.supabase.co/storage/v1/
-- object/public/<bucket>/<path>` is classified by isExternalImageUrl() as a
-- URL the user pasted. It is therefore passed through UNSIGNED, 400s forever
-- against the now-private bucket, and is re-accepted by the write guard on
-- every subsequent save. No error, no log -- the image simply never loads
-- again. Refusing to apply is strictly better than that.
--
-- Matched on the path segment rather than the host, because the host is the
-- project ref and a dump restored into a different project would carry the old
-- one. `/object/public/` is the shape of the endpoint, whatever the host.
-- -----------------------------------------------------------------------------
do $$
declare
  v_legacy int;
begin
  select (select count(*) from public.wishlist_items where image_url like '%/object/public/%')
       + (select count(*) from public.tracked_gifts  where photo_url like '%/object/public/%')
    into v_legacy;

  if v_legacy <> 0 then
    raise exception
      'MIGRATION FAIL: % row(s) still hold a legacy public storage URL. Making the buckets private would break every one of them silently -- they would be treated as pasted external URLs, never signed, and 404 forever. Convert them to object paths first; this migration deliberately carries no backfill.',
      v_legacy;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 1. The buckets themselves.
--
-- `update`, not `insert ... on conflict`: the baseline already created both and
-- re-asserting their mime/size settings here would fork the definition across
-- two migrations. The bucket flag is the only thing this migration owns.
--
-- Flipping `public` to false is what closes the unauthenticated object
-- endpoint. The policy work below is the second door, not a substitute for it:
-- a public bucket serves bytes without consulting storage.objects RLS at all.
-- -----------------------------------------------------------------------------
update storage.buckets
   set public = false
 where id in ('wishlist-images', 'gift-photos');

do $$
declare
  v_missing text;
begin
  select string_agg(b.id, ', ')
    into v_missing
    from (values ('wishlist-images'), ('gift-photos')) as b(id)
   where not exists (select 1 from storage.buckets s where s.id = b.id);

  if v_missing is not null then
    raise exception
      'MIGRATION FAIL: bucket(s) % do not exist, so nothing was made private. The baseline creates them; this migration only flips the flag.',
      v_missing;
  end if;
end $$;


-- -----------------------------------------------------------------------------
-- 2. The `to public` SELECT policies, replaced with owner-scoped ones.
--
-- Dropped by the names the baseline used. The new names are different on
-- purpose: "Public read access for wishlist images" no longer describes
-- anything true, and leaving a policy called that in the catalog is how the
-- next reader concludes the bucket is still public.
--
-- `if exists` on the drops and unconditional creates: storage.objects is not
-- part of the public schema and survives a `db reset` of it, so these have to
-- be re-runnable.
-- -----------------------------------------------------------------------------
drop policy if exists "Public read access for wishlist images" on storage.objects;
drop policy if exists "Public read access for gift photos"     on storage.objects;

drop policy if exists "Users can read own wishlist images" on storage.objects;
drop policy if exists "Users can read own gift photos"     on storage.objects;

create policy "Users can read own wishlist images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'wishlist-images'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );

create policy "Users can read own gift photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'gift-photos'
    and (storage.foldername(name))[1] = (select public.requesting_user_id())
  );


-- -----------------------------------------------------------------------------
-- 3. Assert the end state, in this transaction, before it commits.
--
-- The three statements above are each individually plausible-looking and
-- individually insufficient -- a private bucket with a `to public` policy still
-- leaks the object rows, and owner-scoped policies on a public bucket still
-- serve every byte. Checking the RESULT rather than trusting the steps is what
-- makes that combination impossible to ship half-done.
--
-- The INSERT/UPDATE/DELETE policies are asserted too, though this migration
-- does not touch them: their folder-scoping is the premise the read policies
-- are built on. If an object could be written outside its owner's folder, the
-- owner-scoped read would be scoped to nothing in particular.
-- -----------------------------------------------------------------------------
do $$
declare
  v_public_buckets  int;
  v_public_policies int;
  v_own_selects     int;
  v_unscoped_writes int;
begin
  select count(*) into v_public_buckets
    from storage.buckets
   where id in ('wishlist-images', 'gift-photos')
     and public is distinct from false;

  if v_public_buckets <> 0 then
    raise exception
      'MIGRATION FAIL: % bucket(s) are still public. The unauthenticated /object/public/ endpoint would keep serving every gift photo.',
      v_public_buckets;
  end if;

  select count(*) into v_public_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and 'public' = any(roles);

  if v_public_policies <> 0 then
    raise exception
      'MIGRATION FAIL: % policy/policies on storage.objects still apply to PUBLIC, which includes anon.',
      v_public_policies;
  end if;

  -- One owner-scoped SELECT policy per bucket, each naming its bucket and the
  -- folder check. Counting them by shape rather than by name means a policy
  -- that was renamed but gutted does not satisfy this.
  select count(*) into v_own_selects
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and cmd        = 'SELECT'
     and roles::text[] = array['authenticated']
     and qual like '%foldername%'
     and qual like '%requesting_user_id%'
     and (qual like '%wishlist-images%' or qual like '%gift-photos%');

  if v_own_selects <> 2 then
    raise exception
      'MIGRATION FAIL: expected 2 owner-scoped SELECT policies on storage.objects, found %.',
      v_own_selects;
  end if;

  -- Every write policy must still be folder-scoped. INSERT expresses that in
  -- with_check and has no qual; UPDATE has both; DELETE has only qual. Checking
  -- the concatenation covers all three without a per-command branch.
  select count(*) into v_unscoped_writes
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE')
     and coalesce(qual, '') || coalesce(with_check, '') not like '%foldername%';

  if v_unscoped_writes <> 0 then
    raise exception
      'MIGRATION FAIL: % write policy/policies on storage.objects are not folder-scoped to the uploader. Owner-scoped reads mean nothing if writes are not.',
      v_unscoped_writes;
  end if;
end $$;


comment on policy "Users can read own wishlist images" on storage.objects is
  'Owner-scoped read. A VIEWER of someone else''s wishlist does not read these rows at all -- the server action authorises the item under RLS and then signs the object path. See lib/supabase/signed-image.ts.';

comment on policy "Users can read own gift photos" on storage.objects is
  'Owner-scoped read. Tracked gifts are private to their buyer, so this is the only read path that exists for this bucket.';
