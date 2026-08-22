/**
 * A string that has been through the image-value guard.
 *
 * `wishlist_items.image_url` and `tracked_gifts.photo_url` hold either an
 * external URL or an object path in a private bucket, and the difference
 * between a safe value and an unsafe one is not visible in its type: both are
 * strings. The guard in lib/storage/image-value.ts is what separates them --
 * it rejects a path outside the caller's own storage folder, and a link back
 * into our own storage origin.
 *
 * Signing happens later with the service-role key, which does not re-check, so
 * "a future write forgot to call the guard" is not a style problem: it is how a
 * row comes to name a stranger's private object and have the server re-publish
 * it. There is no JS test runner in this repo, so the type system is the only
 * mechanism available to make that a build failure rather than something a
 * reviewer has to notice.
 *
 * Hence the brand. The two columns are declared as `StoredImageValue | null` in
 * their Insert and Update types (Row stays a plain string -- reading one is not
 * the dangerous direction), and the ONLY cast that produces this type lives
 * inside resolveStoredImageValue(). Passing a raw string to those columns is a
 * compile error.
 *
 * The brand is phantom: it exists only in the type system, so a StoredImageValue
 * IS a string at runtime and needs no unwrapping.
 */
declare const storedImageBrand: unique symbol;

export type StoredImageValue = string & { readonly [storedImageBrand]: true };
