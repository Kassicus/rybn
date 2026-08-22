import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isOwnedStoragePath } from "@/lib/storage/image-value";
import { safeFetch } from "./safe-fetch";

/**
 * Copy the image a page advertises into the user's own storage folder.
 *
 * Three things about this module are load-bearing rather than tidy:
 *
 *   1. The image URL goes back through `safeFetch`. Task 4's extractor does not
 *      validate the URL it returns -- it reports what the page claimed, and a
 *      page is free to claim `http://169.254.169.254/latest/meta-data/`. The
 *      page fetch being guarded says nothing about this one: `<meta
 *      property="og:image">` is a second, independently attacker-chosen URL,
 *      and fetching it unguarded would reopen exactly the hole the guarded
 *      fetcher exists to close. There is no other fetch in this file, by
 *      design.
 *
 *   2. The content type is decided by the bytes, never by the header. See
 *      `sniff`.
 *
 *   3. The upload goes through the caller's USER-SCOPED client. The storage
 *      INSERT policy -- `(storage.foldername(name))[1] = requesting_user_id()`
 *      -- is what confines a user to their own folder, and the admin client
 *      bypasses RLS entirely, so an admin client here would turn a
 *      page-controlled value into a write anywhere in the bucket. The client is
 *      a parameter rather than something this module builds, so the call site
 *      is where that choice is visible.
 *
 * And it never throws. A page whose image is missing, oversized, hostile or
 * simply not an image must still yield its title and its price; losing the
 * whole lookup over a decorative field would be the wrong trade. Every failure
 * is `null`.
 */

/**
 * Matches the bucket's `file_size_limit` (5242880 bytes), verified live.
 *
 * The cap is enforced twice for different reasons. `safeFetch` counts bytes as
 * they arrive, against the DECODED stream, so a compressed bomb never gets
 * buffered; that is the memory guard. The check after it is the contract guard:
 * this number has to equal the bucket's limit or the failure moves server-side,
 * where it costs a round trip and returns an opaque error.
 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * The bucket's `allowed_mime_types`, and the extension we file each under.
 *
 * Sniffing a type that the bucket would refuse is not a sniff failure, it is an
 * upload that fails after the network cost. Keep the two in step.
 */
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

/** PNG's eight-byte signature. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The four ASCII tags that appear inside container headers.
 *
 * Built with `latin1`, NOT `ascii`, and that is the whole point of hoisting
 * them out of `sniff`. Node's `ascii` decoder is not a validator: it MASKS THE
 * HIGH BIT, so `Buffer.from([0xc7, 0xc9, 0xc6, 0xb8, 0xb7, 0xe1])
 * .toString("ascii")` is the string `"GIF87a"`, and a `RIFF`/`WEBP` check
 * written the same way accepts `0xd2 0xc9 0xc6 0xc6 ... 0xd7 0xc5 0xc2 0xd0`.
 * A "magic byte" check that treats 128 different byte strings as the magic is
 * not one. Comparing buffers compares bytes.
 */
const GIF87A = Buffer.from("GIF87a", "latin1");
const GIF89A = Buffer.from("GIF89a", "latin1");
const RIFF = Buffer.from("RIFF", "latin1");
const WEBP = Buffer.from("WEBP", "latin1");

/**
 * What these bytes actually are, or `null` if they are not an image we take.
 *
 * The declared `content-type` is not consulted, and `safeFetch` does not
 * enforce the `Accept` we send (which is why its option is named
 * `acceptHeader`). Both the header and the request hint are attacker-influenced
 * -- the page picks the image URL, and the host it points at picks the
 * response headers -- so the only statement about this body that the attacker
 * does not author is the body itself.
 *
 * A `null` here is a refusal, not a fallback. There is no "assume JPEG" branch:
 * an unrecognised body is an unrecognised body, and it stops.
 */
function sniff(buf: Buffer): string | null {
  // JPEG: SOI (FFD8) followed by the first marker's FF.
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG)) {
    return "image/png";
  }
  if (
    buf.length >= 6 &&
    (buf.subarray(0, 6).equals(GIF87A) || buf.subarray(0, 6).equals(GIF89A))
  ) {
    return "image/gif";
  }
  // RIFF is a container: WAV and AVI open the same four bytes. The form tag at
  // offset 8 is what says this particular one holds a WebP.
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).equals(RIFF) &&
    buf.subarray(8, 12).equals(WEBP)
  ) {
    return "image/webp";
  }
  return null;
}

/**
 * Where this user's objects go: `<clerk user id>/<timestamp>-<random>.<ext>`.
 *
 * The same shape a manual upload produces (`components/ui/image-input.tsx`),
 * because the same storage INSERT policy has to accept it and the same reader
 * has to sign it. The first path segment is not a naming convention -- Postgres
 * checks it.
 */
function buildObjectPath(userId: string, ext: string): string {
  return `${userId}/${Date.now()}-${Math.random()
    .toString(36)
    .substring(2)}.${ext}`;
}

export async function ingestImage(
  imageUrl: string,
  userId: string,
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  try {
    const fetched = await safeFetch(imageUrl, {
      maxBytes: MAX_IMAGE_BYTES,
      // A hint to the server about what we want, and nothing more: `safeFetch`
      // does not check the response against it, and neither does anything
      // below. The bytes decide.
      acceptHeader: "image/*",
    });
    if (!fetched.ok) return null;

    const actual = sniff(fetched.body);
    if (!actual) return null;

    const ext = ALLOWED.get(actual);
    if (!ext) return null;

    // Redundant by `safeFetch`'s contract, which caps while streaming. Kept
    // because the bucket refuses above this number too, and a local refusal is
    // cheaper and clearer than a 413 from storage.
    if (fetched.body.length > MAX_IMAGE_BYTES) return null;

    const path = buildObjectPath(userId, ext);

    // The same predicate the write guard applies to this value later
    // (`lib/storage/image-value.ts`). Uploading an object that the guard would
    // then refuse to store just leaves an orphan in the bucket, and a userId
    // that is empty or itself contains a slash produces exactly that -- a path
    // whose first folder is not the user. It runs after the fetch, because the
    // extension is not known until the bytes are, but before the upload, which
    // is the call it is protecting.
    if (!isOwnedStoragePath(path, userId)) return null;

    const { error } = await supabase.storage
      .from("wishlist-images")
      .upload(path, fetched.body, {
        contentType: actual,
        cacheControl: "3600",
        // Never overwrite. A collision here is a bug or a birthday-paradox
        // freak, and either way replacing an existing object is the worse of
        // the two outcomes.
        upsert: false,
      });

    if (error) return null;

    // The path we validated, not the `data.path` the response echoes back.
    // They are the same string today, and the manual upload path in
    // `image-input.tsx` reads the echo -- but only one of the two has been
    // through `isOwnedStoragePath`, and it is this one.
    return path;
  } catch {
    // The promise of this module is that a failed image costs the image and
    // nothing else. A client that throws instead of returning an error -- a
    // transport fault, a malformed URL in the storage layer -- must not
    // propagate past here and take the title and price with it.
    return null;
  }
}

/**
 * Test-only seam. NOT for production code.
 *
 * The two pure decisions -- what these bytes are, and where the object goes --
 * are exposed so they can be exercised directly rather than only through a
 * network round trip and a live bucket. Nothing here can weaken `ingestImage`:
 * the fetch, the guard and the upload are not on this seam.
 */
export const __testing = { sniff, buildObjectPath, MAX_IMAGE_BYTES, ALLOWED };
