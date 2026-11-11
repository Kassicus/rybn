import { createClient } from "@/lib/supabase/server";
import { withSignedWishlistImage } from "@/lib/supabase/signed-image";
import { picturePath, type PictureKind } from "./picture";

/**
 * Uploads with the caller's own Supabase client (the bucket lets each person write only to their own folder), then signs it.
 * Throws when storage refuses or signing fails; mobileRoute logs that and answers 500.
 */
export async function storePicture(
  userId: string,
  bytes: Uint8Array,
  kind: PictureKind,
): Promise<{ imagePath: string; imageUrl: string }> {
  const path = picturePath(userId, kind.extension, Date.now(), crypto.randomUUID());
  const supabase = await createClient();
  const { error } = await supabase.storage
    .from("wishlist-images")
    .upload(path, bytes, { contentType: kind.contentType, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`picture upload failed: ${error.message}`);

  const signed = await withSignedWishlistImage({ image_url: path, user_id: userId }, userId);
  if (signed.image_url === null) throw new Error("picture signing failed");
  return { imagePath: path, imageUrl: signed.image_url };
}
