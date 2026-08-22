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
 * server-only. The one environment value it reads, NEXT_PUBLIC_SUPABASE_URL, is
 * public by definition and is inlined into the client bundle by Next.
 */

import type { Database } from "@/types/database";
import type { StoredImageValue } from "@/types/stored-image";

/**
 * How long a signed image URL stays valid.
 *
 * One hour. The trade is between the exposure window of a URL that leaks (via a
 * Referer header, a pasted link, browser history -- the exact channels that
 * made public buckets a disclosure risk in the first place) and how long a page
 * can sit open before its images fail.
 *
 * Shorter (5-15 min) would break images while someone is still reading a long
 * wishlist: a frequent, visible failure bought against a threat that a leaked
 * URL is already close to worthless at an hour. Longer (a day) starts to
 * reproduce the problem being fixed -- a URL sitting in a Referer log or a chat
 * message stays live long enough for whoever finds it to use it.
 *
 * It buys nothing from the browser cache, and an earlier version of this
 * comment claimed it did. createSignedUrls embeds `exp = now + ttl` in the
 * token, so the URL STRING differs on every mint; the cache key changes with
 * it and the `cacheControl: "3600"` set at upload time never gets the chance to
 * serve a second request. The number is right for the exposure trade alone.
 */
export const SIGNED_IMAGE_TTL_SECONDS = 3600;

/**
 * When a long-lived client view should re-fetch to renew its signed URLs.
 *
 * Five minutes of headroom before expiry, so a renewal that is late (a
 * throttled background tab, a slow action) still lands inside the window.
 *
 * Only Client Components that fetch in an effect need this. A Server Component
 * mints a fresh URL on every render, so navigation and router.refresh() renew
 * it for free -- but neither of those re-runs a useEffect, which is why the
 * one client-fetching page in the app renews on a timer instead.
 */
export const SIGNED_IMAGE_REFRESH_MS = (SIGNED_IMAGE_TTL_SECONDS - 300) * 1000;

/**
 * The HOST our own storage is served from, or "" when it is not configured.
 *
 * Read once at module load. NEXT_PUBLIC_SUPABASE_URL is inlined at build time,
 * so this is a constant string in the client bundle, not a runtime lookup.
 *
 * Host, not origin. An earlier version compared `URL.origin`, which folds in the
 * scheme and the port -- so `http://<our host>/...` compared UNEQUAL to
 * `https://<our host>` and sailed through as a third-party URL. Neither the
 * scheme nor the port changes whose bytes are on the other end, and it is the
 * host that decides that. (URL lower-cases the hostname, so the comparison is
 * already case-insensitive.)
 */
const OWN_STORAGE_HOST = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname;
  } catch {
    return "";
  }
})();

/**
 * True when an http(s) URL points at this project's own Supabase host.
 *
 * Such a URL is never something a user legitimately "pastes from the web" --
 * it is either a signed URL we handed them minutes ago or a legacy public one.
 * Both are refused on write:
 *
 *   - a signed URL is a link that dies within the hour. Storing one produces an
 *     image that works right up until the user stops looking at it, with no
 *     error anywhere.
 *   - and it lets an authorised viewer re-serve someone else's private object
 *     from their own item for the remainder of that hour. Not an escalation --
 *     anyone who can see an image can screenshot it -- but it is a disclosure
 *     path that costs one line to close.
 *
 * Fails OPEN when the origin is unknown (unset or unparseable env var), which
 * only re-admits the status quo ante; the ownership check on object paths is
 * unaffected and does not depend on this.
 */
export function isOwnStorageHost(value: string): boolean {
  if (!OWN_STORAGE_HOST) return false;
  try {
    return new URL(value).hostname === OWN_STORAGE_HOST;
  } catch {
    return false;
  }
}

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
  if (isExternalImageUrl(value)) return !isOwnStorageHost(value);
  return isStorageObjectPath(value);
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
): { ok: true; value: StoredImageValue | null } | { ok: false; error: string } {
  if (value === null || value === undefined || value === "") {
    return { ok: true, value: null };
  }
  if (isExternalImageUrl(value)) {
    if (isOwnStorageHost(value)) {
      return {
        ok: false,
        error:
          "That link points at rybn's own image storage and stops working within the hour. Upload the image instead of pasting its link.",
      };
    }
    return { ok: true, value: value as StoredImageValue };
  }
  if (isOwnedStoragePath(value, userId)) {
    return { ok: true, value: value as StoredImageValue };
  }
  return {
    ok: false,
    error:
      "That image reference is not valid. Upload an image or paste an image URL.",
  };
}

/**
 * Tripwire: the brand is still wired up in types/database.ts.
 *
 * The whole guarantee above is one annotation per column in a file that mirrors
 * the database schema. Nothing stops someone regenerating or hand-editing that
 * file back to `string | null`, and the failure would be invisible -- every
 * existing call site keeps compiling, because a StoredImageValue IS a string.
 * Only NEW unguarded writes would start compiling too, which is exactly the
 * thing nobody would notice.
 *
 * So the loss is made loud. Each assertion says "a plain string must NOT be
 * assignable to this column on write". If the brand is dropped, `string extends
 * string` becomes true, Assert<false> fails, and `npm run type-check` names the
 * column that lost its guard.
 *
 * Type-only: erased at build, costs nothing at runtime.
 */
type Assert<T extends true> = T;

type WriteColumn<
  T extends keyof Database["public"]["Tables"],
  C extends keyof Database["public"]["Tables"][T]["Insert"] &
    keyof Database["public"]["Tables"][T]["Update"],
> =
  | NonNullable<Database["public"]["Tables"][T]["Insert"][C]>
  | NonNullable<Database["public"]["Tables"][T]["Update"][C]>;

type _WishlistImageIsBranded = Assert<
  string extends WriteColumn<"wishlist_items", "image_url"> ? false : true
>;

type _GiftPhotoIsBranded = Assert<
  string extends WriteColumn<"tracked_gifts", "photo_url"> ? false : true
>;
