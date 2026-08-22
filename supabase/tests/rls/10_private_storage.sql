-- Both image buckets are PRIVATE, and storage.objects is readable only by the
-- user whose folder the object sits in.
--
-- The defect this pins: `wishlist-images` and `gift-photos` shipped with
-- `public = true` and a `to public` SELECT policy each. Either one alone hands
-- every gift photo to anyone holding the URL. In an app whose whole point is
-- that a gift stays secret until it is given, that is a disclosure channel, not
-- a convenience -- and it fails silently, which is the worst way for a privacy
-- control to fail.
--
-- Two independent doors, so two independent assertions:
--
--   the BUCKET flag  -- `public = true` makes /storage/v1/object/public/<b>/...
--                       serve the bytes without a session and WITHOUT
--                       consulting storage.objects RLS at all. No policy can
--                       close this one.
--   the POLICY roles -- `to public` includes anon, so the object row itself is
--                       readable by an unauthenticated caller.
--
-- Closing one and not the other looks fixed and is not, which is why the
-- catalog half of this file checks both rather than treating them as one fact.
--
-- WHAT THIS FILE CANNOT PROVE. `public = false` is asserted here as a database
-- fact; that the storage HTTP API then refuses an unsigned request for a
-- private object is storage-api behaviour, not a database behaviour, and no SQL
-- assertion reaches it.
--
-- WHAT THE OWNER-SCOPED POLICY DELIBERATELY DOES NOT DO. It gives a viewer no
-- read path to the image on someone else's wishlist item, because there is no
-- honest one to give: "may this viewer see this image" is really "may this
-- viewer see the wishlist ITEM it hangs off", a privacy_settings lookup across
-- group membership that storage.objects knows nothing about. That authorisation
-- is made in the server action, which reads the row under RLS and only then
-- signs the object path (lib/supabase/signed-image.ts). So the correct
-- expectation for the assertions below is that a non-owner sees NOTHING here --
-- a policy generous enough to let a viewer read the row directly would be the
-- bug, not the feature.
--
-- The behavioural half inserts probe objects as the connect role (which
-- bypasses RLS) and then reads them back as `authenticated` and as `anon`. It
-- is two-sided on purpose: a "nobody can see it" assertion passes just as
-- happily against an INSERT that silently did nothing, so the count as the
-- bypassing role is checked first.

create temp table _harness_result (token text);

do $$
declare
  v_orig_role       text;
  v_who             text;
  v_bucket_count    int;
  v_public_buckets  int;
  v_public_policies int;
  v_own_selects     int;
  v_unscoped_writes int;
  v_total_policies  int;
  v_probe_total     int;
  v_own_image       int;
  v_other_image     int;
  v_own_photo       int;
  v_other_photo     int;
  v_anon_visible    int;
  v_checks          int := 0;
begin
  select current_user into v_orig_role;

  ---------------------------------------------------------------------------
  -- Catalog half.
  --
  -- Population control first: every count below is a "should be zero" or a
  -- "should be exactly N", and all of them pass trivially against a catalog
  -- query that has stopped matching anything.
  ---------------------------------------------------------------------------
  select count(*) into v_bucket_count
    from storage.buckets
   where id in ('wishlist-images', 'gift-photos');

  if v_bucket_count <> 2 then
    raise exception
      'CONTROL FAIL: expected 2 image buckets, found %. The bucket assertions below are inspecting nothing.',
      v_bucket_count;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_public_buckets
    from storage.buckets
   where id in ('wishlist-images', 'gift-photos')
     and public is distinct from false;

  if v_public_buckets <> 0 then
    raise exception
      'STORAGE FAIL: % image bucket(s) are public. The unauthenticated object endpoint serves every wishlist image and gift photo to anyone holding the URL, signed in or not.',
      v_public_buckets;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- No policy on storage.objects may apply to PUBLIC. Stronger than "no
  -- `to public` SELECT policy" on purpose: PUBLIC includes anon for INSERT and
  -- DELETE just as much as for SELECT, and none of them should ever be open.
  ---------------------------------------------------------------------------
  select count(*) into v_public_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and 'public' = any(roles);

  if v_public_policies <> 0 then
    raise exception
      'STORAGE FAIL: % policy/policies on storage.objects apply to PUBLIC, which includes anon. Name the role: `to authenticated`.',
      v_public_policies;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The replacement reads: one per bucket, restricted to `authenticated`, and
  -- scoped by the object's first folder. Matched by SHAPE rather than by name,
  -- so a policy that kept its name and lost its scoping does not satisfy this.
  ---------------------------------------------------------------------------
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
      'STORAGE FAIL: expected 2 owner-scoped SELECT policies on storage.objects (one per bucket, to authenticated, scoped by storage.foldername), found %.',
      v_own_selects;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Writes must stay folder-scoped, or the owner-scoped read is scoped to
  -- nothing in particular. INSERT expresses the scope in with_check and has no
  -- qual, DELETE has only qual, UPDATE has both; checking the concatenation
  -- covers all three without a per-command branch.
  ---------------------------------------------------------------------------
  select count(*) into v_unscoped_writes
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects'
     and cmd in ('INSERT', 'UPDATE', 'DELETE')
     and coalesce(qual, '') || coalesce(with_check, '') not like '%foldername%';

  if v_unscoped_writes <> 0 then
    raise exception
      'STORAGE FAIL: % write policy/policies on storage.objects are not scoped to the uploader''s folder. A user who can write into another user''s folder makes every owner-scoped read meaningless.',
      v_unscoped_writes;
  end if;
  v_checks := v_checks + 1;

  -- Second population control. Without it, a storage.objects that had lost
  -- every policy would sail through both zero-counts above.
  --
  -- A FLOOR, not an equality. A policy going missing is what this control is
  -- for; a policy being ADDED is deliberately left to the behavioural half
  -- below, because that is where it can be judged. An added `to anon` SELECT
  -- policy slips past every catalog check here -- its roles are not PUBLIC, and
  -- it does not change the count of owner-scoped policies -- and is caught by
  -- anon actually reading a row. Pinning the count to exactly 8 would trip
  -- first and mask which of the two problems it is.
  select count(*) into v_total_policies
    from pg_policies
   where schemaname = 'storage'
     and tablename  = 'objects';

  if v_total_policies < 8 then
    raise exception
      'CONTROL FAIL: only % policy/policies on storage.objects, expected at least 8 (select/insert/update/delete for each of 2 buckets). Policies have gone missing, so the checks above no longer describe this schema.',
      v_total_policies;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- Behavioural half.
  --
  -- Four probe objects: one per user per bucket. Inserted as the connect role,
  -- which has rolbypassrls, so the insert itself is not a test of anything --
  -- it is the fixture the reads are tested against. Rolled back with the rest
  -- of the file.
  ---------------------------------------------------------------------------
  insert into storage.objects (bucket_id, name, owner_id) values
    ('wishlist-images', 'user_probe_a/a.jpg', 'user_probe_a'),
    ('wishlist-images', 'user_probe_b/b.jpg', 'user_probe_b'),
    ('gift-photos',     'user_probe_a/a.jpg', 'user_probe_a'),
    ('gift-photos',     'user_probe_b/b.jpg', 'user_probe_b');

  select count(*) into v_probe_total
    from storage.objects
   where name like 'user_probe_%';

  if v_probe_total <> 4 then
    raise exception
      'CONTROL FAIL: % probe object(s) present before the role switch, expected 4. The fixture is broken, so the visibility counts below would prove nothing.',
      v_probe_total;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- The switch that makes RLS apply at all. The CLI connects as a role with
  -- rolbypassrls; without this every assertion below is vacuous.
  ---------------------------------------------------------------------------
  perform set_config('request.jwt.claims',
    '{"sub":"user_probe_a","role":"authenticated"}', true);
  perform set_config('role', 'authenticated', true);

  select current_user into v_who;
  if v_who is distinct from 'authenticated' then
    raise exception
      'HARNESS FAIL: role switch did not take effect, current_user is %. RLS would be bypassed and every storage assertion below would be vacuous.',
      v_who;
  end if;
  v_checks := v_checks + 1;

  -- Positive: a user still reaches their own objects, in both buckets. The
  -- lockdown must not have cost them the ability to manage what they uploaded.
  select count(*) into v_own_image
    from storage.objects
   where bucket_id = 'wishlist-images' and name = 'user_probe_a/a.jpg';

  if v_own_image <> 1 then
    raise exception
      'STORAGE FAIL: a user cannot read their own wishlist image row (saw %, expected 1). The owner-scoped SELECT policy is missing or mis-scoped.',
      v_own_image;
  end if;
  v_checks := v_checks + 1;

  -- Negative: and reaches nobody else's.
  select count(*) into v_other_image
    from storage.objects
   where bucket_id = 'wishlist-images' and name = 'user_probe_b/b.jpg';

  if v_other_image <> 0 then
    raise exception
      'STORAGE FAIL: user_probe_a can read user_probe_b''s wishlist image row (saw %, expected 0). Someone else''s private image is visible.',
      v_other_image;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_own_photo
    from storage.objects
   where bucket_id = 'gift-photos' and name = 'user_probe_a/a.jpg';

  if v_own_photo <> 1 then
    raise exception
      'STORAGE FAIL: a user cannot read their own gift photo row (saw %, expected 1).',
      v_own_photo;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_other_photo
    from storage.objects
   where bucket_id = 'gift-photos' and name = 'user_probe_b/b.jpg';

  if v_other_photo <> 0 then
    raise exception
      'STORAGE FAIL: user_probe_a can read user_probe_b''s gift photo row (saw %, expected 0). Tracked gifts are private to the person buying them.',
      v_other_photo;
  end if;
  v_checks := v_checks + 1;

  ---------------------------------------------------------------------------
  -- And the unauthenticated role sees nothing at all. `anon` holds a plain
  -- SELECT grant on storage.objects (Supabase issues it to every project and
  -- this migration does not revoke it), so policies are the ONLY thing standing
  -- between anon and every object row. That is exactly what the old
  -- `to public` policy handed over.
  --
  -- Back to the original role first: `authenticated` cannot SET ROLE anon.
  ---------------------------------------------------------------------------
  perform set_config('role', v_orig_role, true);
  perform set_config('role', 'anon', true);

  select current_user into v_who;
  if v_who is distinct from 'anon' then
    raise exception
      'HARNESS FAIL: could not switch to anon, current_user is %. The anonymous read check below would be vacuous.',
      v_who;
  end if;
  v_checks := v_checks + 1;

  select count(*) into v_anon_visible
    from storage.objects
   where name like 'user_probe_%';

  if v_anon_visible <> 0 then
    raise exception
      'STORAGE FAIL: anon can read % storage object row(s). An unauthenticated caller is enumerating private gift images.',
      v_anon_visible;
  end if;
  v_checks := v_checks + 1;

  perform set_config('role', v_orig_role, true);

  ---------------------------------------------------------------------------
  -- 14 assertions. Raise this floor when you add one.
  ---------------------------------------------------------------------------
  if v_checks < 14 then
    raise exception
      'HARNESS FAIL: only % assertion(s) ran, expected at least 14. Assertions were skipped or commented out; this file proves nothing.',
      v_checks;
  end if;

  insert into _harness_result values ('OK_10_private_storage');
end $$;

select token as result from _harness_result;
