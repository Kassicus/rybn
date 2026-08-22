// Signing reaches lib/supabase/admin.ts -> the service-role key, so this
// module must never be pulled into a client bundle. `server-only` makes that a
// build error rather than a code-review question.
import "server-only";

import { createAdminClient } from "./admin";
import {
  isExternalImageUrl,
  SIGNED_IMAGE_TTL_SECONDS,
} from "@/lib/storage/image-value";

// Re-exported so server code can reach the lifetime without importing the
// shared module directly. It LIVES there, not here, because the one client
// page that renews its own signed URLs needs the same number and cannot import
// this server-only module to get it.
export { SIGNED_IMAGE_TTL_SECONDS };

/**
 * Turning a stored object path into something an <img> can load.
 *
 * Both buckets are PRIVATE. The only way a browser gets the bytes is a signed
 * URL, and this is the single place one is minted.
 *
 * WHY HERE AND NOT IN A STORAGE POLICY
 * ------------------------------------
 * The question that decides whether a viewer may see a wishlist image is "may
 * this viewer see the wishlist ITEM the image belongs to" -- a privacy_settings
 * lookup across group membership. `storage.objects` holds none of that; a
 * policy could only guess from the object's path, and a path convention is not
 * an authorisation model. So the decision is made where it can actually be
 * evaluated: the server action queries the row under RLS, and RLS either
 * returns the row or does not. Signing happens strictly AFTER that, on rows the
 * caller was already permitted to read. The admin client is used to MINT the
 * URL, never to decide who gets one.
 *
 * The write side is guarded separately -- see isOwnedStoragePath() in
 * lib/storage/image-value.ts. Because signing bypasses RLS, a row may only ever
 * name a path inside its own author's folder; otherwise "sign whatever this row
 * points at" would be a way to re-publish someone else's private object.
 */

export type ImageBucket = "wishlist-images" | "gift-photos";

/**
 * Sign a batch of values against one bucket, preserving input positions.
 *
 * External URLs pass straight through. Object paths are signed in ONE round
 * trip via createSignedUrls, so a wishlist of N images costs one storage call,
 * not N. A path that cannot be signed (deleted object, storage error) comes
 * back null: the row is still returned, just without an image. Failing the
 * whole read because one thumbnail is missing would be the wrong trade.
 */
async function signValues(
  bucket: ImageBucket,
  values: (string | null | undefined)[]
): Promise<(string | null)[]> {
  const signed: (string | null)[] = values.map((v) =>
    isExternalImageUrl(v) ? v : null
  );

  const paths = values.filter(
    (v): v is string => typeof v === "string" && v !== "" && !isExternalImageUrl(v)
  );

  if (paths.length === 0) {
    return signed;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(bucket)
    .createSignedUrls(paths, SIGNED_IMAGE_TTL_SECONDS);

  if (error || !data) {
    console.error(`[signed-image] could not sign ${bucket} paths:`, error);
    return signed;
  }

  // Keyed by path rather than by array position: the API's ordering is not part
  // of its contract, and duplicate paths in one batch map to the same URL.
  const byPath = new Map<string, string>();
  for (const entry of data) {
    if (entry.path && !entry.error && entry.signedUrl) {
      byPath.set(entry.path, entry.signedUrl);
    }
  }

  return values.map((v, i) =>
    signed[i] !== null ? signed[i] : typeof v === "string" ? byPath.get(v) ?? null : null
  );
}

type WishlistImageRow = {
  image_url?: string | null;
  user_id?: string | null;
};

type SignedWishlistRow<T> = T & {
  image_url: string | null;
  image_path: string | null;
};

type GiftPhotoRow = {
  photo_url?: string | null;
};

type SignedGiftRow<T> = T & {
  photo_url: string | null;
  photo_path: string | null;
};

/**
 * The raw stored value, masked when it is an object path the viewer does not own.
 *
 * `image_path` exists so the EDIT form can round-trip the stored value: if the
 * form were seeded with the signed URL it renders, saving would overwrite the
 * path with a URL that expires in an hour. Only the owner ever edits, so only
 * the owner needs the path.
 *
 * A viewer still gets the value when it is an external URL, because that is not
 * a secret and "Add to Gift Tracker" copies it onto the viewer's own gift. A
 * viewer never gets another user's object path -- inert today (the write-side
 * ownership check refuses it) but there is no reason to hand it over, and not
 * handing it over is what keeps that check from being the only thing standing
 * between a path and a signed URL.
 */
function visiblePath(raw: string | null | undefined, isOwner: boolean): string | null {
  if (!raw) return null;
  if (isExternalImageUrl(raw)) return raw;
  return isOwner ? raw : null;
}

export async function withSignedWishlistImages<T extends WishlistImageRow>(
  items: T[],
  viewerId: string
): Promise<SignedWishlistRow<T>[]> {
  const signed = await signValues(
    "wishlist-images",
    items.map((i) => i.image_url)
  );

  return items.map((item, i) => ({
    ...item,
    image_url: signed[i],
    image_path: visiblePath(item.image_url, item.user_id === viewerId),
  }));
}

export async function withSignedWishlistImage<T extends WishlistImageRow>(
  item: T,
  viewerId: string
): Promise<SignedWishlistRow<T>> {
  const [signed] = await withSignedWishlistImages([item], viewerId);
  return signed;
}

/**
 * Tracked gifts are private to their owner -- every read filters
 * `user_id = <caller>` on top of RLS -- so the caller is always the owner and
 * the path is never masked.
 */
export async function withSignedGiftPhotos<T extends GiftPhotoRow>(
  gifts: T[]
): Promise<SignedGiftRow<T>[]> {
  const signed = await signValues(
    "gift-photos",
    gifts.map((g) => g.photo_url)
  );

  return gifts.map((gift, i) => ({
    ...gift,
    photo_url: signed[i],
    photo_path: gift.photo_url ?? null,
  }));
}

export async function withSignedGiftPhoto<T extends GiftPhotoRow>(
  gift: T
): Promise<SignedGiftRow<T>> {
  const [signed] = await withSignedGiftPhotos([gift]);
  return signed;
}
