"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth/require-auth";
import { safeFetch } from "@/lib/link-metadata/safe-fetch";
import { extractMetadata } from "@/lib/link-metadata/extract";
import { ingestImage } from "@/lib/link-metadata/ingest-image";
import { withSignedWishlistImage } from "@/lib/supabase/signed-image";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const RATE_LIMIT = 20;
const RATE_WINDOW_MINUTES = 10;

export interface LinkMetadataResult {
  title?: string;
  description?: string;
  price?: number;
  /**
   * The STORED value: an object path inside the private `wishlist-images`
   * bucket. This is what the form writes to the row.
   */
  imagePath?: string;
  /**
   * The RENDERABLE value for that same object: a signed URL, good for an hour.
   *
   * Two fields for the same image because the bucket is private and the two
   * jobs are different -- exactly the split `components/ui/image-input.tsx`
   * documents, and the same pair every other read path in the app hands that
   * component (`image_url`/`image_path` from `withSignedWishlistImages`,
   * `photo_url`/`photo_path` from `withSignedGiftPhotos`). It expires, so it
   * must never be stored back into the row.
   *
   * `undefined` when there is no image, or when the object could not be signed.
   * The form falls back to its "attached, preview unavailable" state, which is
   * what it did for every ingested image before this field existed.
   */
  imagePreviewUrl?: string;
  error?: string;
}

/**
 * Read a user-supplied product URL and return what can be filled into a
 * wishlist item form. Never throws, and never returns raw error text: every
 * `error` here is one of the sentences written for a human, either by
 * `safeFetch` or by this file.
 *
 * TWO DIFFERENT SUPABASE CLIENTS ARE USED BELOW AND THEY ARE NOT
 * INTERCHANGEABLE.
 *
 *   - The rate-limit ledger uses the SERVICE-ROLE client. `link_fetch_log` has
 *     RLS on and zero policies, so nothing but the service role can touch it.
 *     That is the point: the row is a counter, not user content, and a user
 *     who could delete their own rows would have no rate limit at all. For the
 *     same reason the table carries NO foreign key to `user_profiles`: users
 *     may delete their own profile row, and a cascade from that DELETE would
 *     have been a one-call reset of their own quota (see 20260826000000).
 *
 *   - `ingestImage` gets the USER-SCOPED client. The storage INSERT policy
 *     `(storage.foldername(name))[1] = requesting_user_id()` is the only thing
 *     confining an upload to the caller's own folder, and it is evaluated
 *     against the querying role. Handing the admin client to `ingestImage`
 *     would bypass RLS entirely and turn that guarantee off -- silently, since
 *     the happy path would look identical.
 */
export async function fetchLinkMetadata(url: string): Promise<LinkMetadataResult> {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated" };

  // The ledger is service-role only: it is a counter, not user content, and a
  // user must not be able to read or trim their own.
  const admin = createAdminClient();
  const since = new Date(Date.now() - RATE_WINDOW_MINUTES * 60_000).toISOString();

  // A failed READ is deliberately not checked, and does not need to be:
  // `count` comes back null, which reads as 0 and lets the request past this
  // branch -- but the WRITE below is where an unreachable ledger stops it.
  // These are one policy, not two contradictory ones. An outage cannot open the
  // gate, because the gate is the insert.
  const { count } = await admin
    .from("link_fetch_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("fetched_at", since);

  if ((count ?? 0) >= RATE_LIMIT) {
    return { error: "You have looked up a lot of links just now. Try again in a few minutes." };
  }

  // THE LEDGER IS AUTHORITATIVE: if the fetch cannot be recorded, it does not
  // happen. supabase-js reports a rejected write by RETURNING `{ error }`
  // rather than throwing, so discarding this result would let a ledger that had
  // stopped accepting rows read as a ledger at zero -- a rate limit that has
  // silently ceased to exist, looking exactly like one that works.
  //
  // With the user_profiles foreign key dropped (migration 20260826000000) there
  // is no ordinary way for this to fail, and that is precisely why it is now
  // fatal rather than merely logged: it fires only for a real outage, and an
  // outage should cost the lookup rather than the limit.
  //
  // Refusing here does not block SAVING. The user types the title and price
  // themselves, exactly as they did before this feature existed; what is lost
  // is the convenience, not the item.
  //
  // Read-then-write, not an atomic reservation: two requests racing can both
  // read 19 and both proceed. A limit that is occasionally 21 instead of 20
  // still bounds a user turning the fetcher into a scanner, which is what it is
  // for.
  const { error: logError } = await admin
    .from("link_fetch_log")
    .insert({ user_id: userId });
  if (logError) {
    console.error("fetchLinkMetadata: rate-limit ledger insert failed", logError);
    return { error: "We could not look that link up just now. Please try again." };
  }

  const page = await safeFetch(url, {
    maxBytes: MAX_HTML_BYTES,
    acceptHeader: "text/html",
  });
  if (!page.ok) return { error: page.reason };

  // contentType is `string | null` -- null means the response carried no
  // content-type header at all. Task 3 deliberately made that a separate value
  // rather than "", so a missing header cannot be mistaken for a present one.
  // Both are refused here: we will not parse a body that never claimed to be
  // HTML.
  if (!page.contentType?.startsWith("text/html")) {
    return { error: "That link is not a web page we can read." };
  }

  // `page.finalUrl`, NOT `url`. Relative references in the page -- an
  // `og:image` of `/img/product.jpg` -- resolve against the address the
  // document was served from, and after a redirect that is not the address the
  // user pasted. Link shorteners, geo redirects and utm-stripping redirects are
  // routine on product links, so passing `url` here resolved the image against
  // the wrong host and lost it to a 404 with nothing logged and nothing shown.
  //
  // The value is safe to use as a base and no safer to fetch than the original:
  // every hop that produced it went through the same address checks, and the
  // image URL that comes back out of the extractor is still unvalidated and
  // still goes back through `safeFetch` below.
  const meta = extractMetadata(page.body.toString("utf8"), page.finalUrl);

  // The image is best-effort: losing it must not lose the text.
  //
  // `meta.imageUrl` is UNVALIDATED -- `extractMetadata` reports what the page
  // advertised, which may be `http://169.254.169.254/...`. It is never fetched
  // here. `ingestImage` runs it back through `safeFetch`, and that revalidation
  // is the SSRF defence, so this must stay the only thing done with the value.
  let imagePath: string | undefined;
  let imagePreviewUrl: string | undefined;
  if (meta.imageUrl) {
    const supabase = await createClient();
    const stored = await ingestImage(meta.imageUrl, userId, supabase);
    if (stored) {
      imagePath = stored;

      // The path alone is not renderable: the bucket is private, and the client
      // cannot sign anything (signing needs the service-role key). Without this
      // the add form fills in an image the user cannot see -- a grey "preview
      // unavailable" box for the one field the whole feature exists to fill.
      //
      // Signed through the app's single minting helper rather than a second
      // mechanism, so this URL has the same TTL and the same shape as the one
      // the wishlist page hands the edit form. `userId` is both the owner and
      // the viewer here -- the object was just written into that user's own
      // folder by that user's own client -- so the helper's ownership check is
      // satisfied by construction.
      //
      // Failing to sign costs the preview and nothing else: `image_url` is
      // already filled, the row still saves, and the image still renders on
      // /wishlist afterwards.
      const signed = await withSignedWishlistImage(
        { image_url: stored, user_id: userId },
        userId
      );
      imagePreviewUrl = signed.image_url ?? undefined;
    }
  }

  return {
    title: meta.title,
    description: meta.description,
    price: meta.price,
    imagePath,
    imagePreviewUrl,
  };
}
