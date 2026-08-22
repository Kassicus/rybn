"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getUserId } from "@/lib/auth/require-auth";
import { safeFetch } from "@/lib/link-metadata/safe-fetch";
import { extractMetadata } from "@/lib/link-metadata/extract";
import { ingestImage } from "@/lib/link-metadata/ingest-image";

const MAX_HTML_BYTES = 2 * 1024 * 1024;
const RATE_LIMIT = 20;
const RATE_WINDOW_MINUTES = 10;

export interface LinkMetadataResult {
  title?: string;
  description?: string;
  price?: number;
  imagePath?: string;
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

  const meta = extractMetadata(page.body.toString("utf8"), url);

  // The image is best-effort: losing it must not lose the text.
  //
  // `meta.imageUrl` is UNVALIDATED -- `extractMetadata` reports what the page
  // advertised, which may be `http://169.254.169.254/...`. It is never fetched
  // here. `ingestImage` runs it back through `safeFetch`, and that revalidation
  // is the SSRF defence, so this must stay the only thing done with the value.
  let imagePath: string | undefined;
  if (meta.imageUrl) {
    const supabase = await createClient();
    imagePath = (await ingestImage(meta.imageUrl, userId, supabase)) ?? undefined;
  }

  return {
    title: meta.title,
    description: meta.description,
    price: meta.price,
    imagePath,
  };
}
