-- Create storage buckets for image uploads
-- Wishlist item images
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wishlist-images',
  'wishlist-images',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Gift tracker photos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'gift-photos',
  'gift-photos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- RLS Policies for wishlist-images bucket
-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload wishlist images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'wishlist-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to update their own images
CREATE POLICY "Users can update own wishlist images"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'wishlist-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'wishlist-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to delete their own images
CREATE POLICY "Users can delete own wishlist images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'wishlist-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow public read access (images are public)
CREATE POLICY "Public read access for wishlist images"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'wishlist-images');

-- RLS Policies for gift-photos bucket
-- Allow authenticated users to upload to their own folder
CREATE POLICY "Users can upload gift photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'gift-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to update their own images
CREATE POLICY "Users can update own gift photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'gift-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'gift-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow authenticated users to delete their own images
CREATE POLICY "Users can delete own gift photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'gift-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow public read access (images are public)
CREATE POLICY "Public read access for gift photos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'gift-photos');
