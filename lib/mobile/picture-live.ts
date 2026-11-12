import { createClient } from "@/lib/supabase/server";
import { withSignedGiftPhoto, withSignedWishlistImage, type ImageBucket } from "@/lib/supabase/signed-image";
import { checkPicture, picturePath, type PictureKind } from "./picture";
import { mobileError } from "./route";

/**
 * Uploads with the caller's own Supabase client (the bucket lets each person write only to their own folder), then signs it.
 * Throws when storage refuses or signing fails; mobileRoute logs that and answers 500.
 */
export async function storePicture(
  userId: string,
  bytes: Uint8Array,
  kind: PictureKind,
  bucket: ImageBucket,
): Promise<{ imagePath: string; imageUrl: string }> {
  const path = picturePath(userId, kind.extension, Date.now(), crypto.randomUUID());
  const supabase = await createClient();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { contentType: kind.contentType, cacheControl: "3600", upsert: false });
  if (error) throw new Error(`picture upload failed: ${error.message}`);

  const signedUrl =
    bucket === "gift-photos"
      ? (await withSignedGiftPhoto({ photo_url: path })).photo_url
      : (await withSignedWishlistImage({ image_url: path, user_id: userId }, userId)).image_url;
  if (signedUrl === null) throw new Error("picture signing failed");
  return { imagePath: path, imageUrl: signedUrl };
}

/**
 * The body of a picture route: the phone sends raw bytes (the route has no `body` option, which would read JSON).
 * 422 with the rule's own sentence for a picture that is not allowed; otherwise stores it in `bucket`.
 */
export async function pictureAnswer(
  userId: string,
  request: Request,
  bucket: ImageBucket,
): Promise<Response | { imagePath: string; imageUrl: string }> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const checked = checkPicture(request.headers.get("content-type"), bytes);
  if (!checked.ok) return mobileError("invalid", checked.message);
  return storePicture(userId, bytes, checked, bucket);
}
