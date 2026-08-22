/**
 * What a stored image field actually holds, and how to tell the two cases apart.
 *
 * `wishlist_items.image_url` and `tracked_gifts.photo_url` each hold ONE of:
 *
 *   - an absolute http(s) URL the user pasted (an Amazon product shot, say).
 *     Nothing of ours is involved; it is rendered as-is.
 *   - an object PATH inside one of our two private buckets, of the shape
 *     `<clerk user id>/<timestamp>-<random>.<ext>`. It is NOT a URL and is not
 *     renderable on its own -- a server action signs it on the way out.
 *
 * The column name still says `_url` because the column is unchanged; only what
 * we put in it changed. Every consumer that has to distinguish the two cases
 * routes through this module rather than re-deriving the test, because getting
 * it wrong in the permissive direction is how a private object path ends up
 * treated as a public URL.
 *
 * This module is deliberately pure and dependency-free: it is imported from
 * both `"use client"` components and server actions. Nothing here touches the
 * service-role key -- signing lives in `lib/supabase/signed-image.ts`, which is
 * server-only.
 */

/**
 * True when the value is an absolute http(s) URL rather than an object path.
 *
 * Anchored and scheme-restricted on purpose. A bare `//host/x` or a
 * `javascript:` payload is not an http(s) URL and must fall through to the
 * path branch, where the shape check below rejects it.
 */
export function isExternalImageUrl(
  value: string | null | undefined
): value is string {
  return typeof value === "string" && /^https?:\/\/\S+$/i.test(value);
}

/**
 * True when the value has the shape of an object path in one of our buckets.
 *
 * Requires at least one `/`, because every object we write is folder-scoped to
 * its uploader -- a bare filename could never have been produced by our upload
 * path and must not be accepted as one. `..` is rejected outright, and the
 * character class admits nothing that could introduce a scheme, a host, or a
 * query string.
 *
 * Shape only. Whether the CALLER may point at this path is a separate question,
 * answered by isOwnedStoragePath().
 */
export function isStorageObjectPath(value: string): boolean {
  if (value.length === 0 || value.length > 1024) return false;
  if (value.includes("..")) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/.test(
    value
  );
}

/**
 * Form-level validation: is this something we are willing to store at all?
 *
 * Shape only, because a form cannot answer the ownership question -- the field
 * is either a URL the user typed or a path our own upload just produced. The
 * server re-checks ownership on write; this only keeps a typo from reaching it.
 */
export function isValidImageValue(value: string): boolean {
  return isExternalImageUrl(value) || isStorageObjectPath(value);
}

/**
 * True when the value is an object path whose first folder is this user's id.
 *
 * This is the client-side twin of the storage INSERT policy
 *
 *     (storage.foldername(name))[1] = (select public.requesting_user_id())
 *
 * and it exists because signing happens with the ADMIN client, which bypasses
 * RLS. Without this check a user could store SOMEONE ELSE'S object path in
 * their own wishlist item and have the server hand out a signed URL for it to
 * everyone who can see that item -- re-publishing a stranger's private image
 * through a row they legitimately own. The upload policy stops them writing
 * into another user's folder; this stops them REFERRING to one.
 */
export function isOwnedStoragePath(value: string, userId: string): boolean {
  return isStorageObjectPath(value) && value.split("/")[0] === userId;
}

/**
 * Validate a user-supplied image field on the way INTO the database.
 *
 * Returns the value to store (null for "no image"), or an error to surface.
 * External URLs pass through untouched; object paths must be the caller's own.
 */
export function resolveStoredImageValue(
  value: string | null | undefined,
  userId: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (isExternalImageUrl(value)) {
    return { ok: true, value };
  }
  if (isOwnedStoragePath(value, userId)) {
    return { ok: true, value };
  }
  return {
    ok: false,
    error:
      "That image reference is not valid. Upload an image or paste an image URL.",
  };
}
