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
 *     who could delete their own rows would have no rate limit at all.
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

  const { count } = await admin
    .from("link_fetch_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("fetched_at", since);

  if ((count ?? 0) >= RATE_LIMIT) {
    return { error: "You have looked up a lot of links just now. Try again in a few minutes." };
  }
  // Read-then-write, not an atomic reservation: two requests racing can both
  // read 19 and both proceed. A limit that is occasionally 21 instead of 20 is
  // fine -- this bounds a user turning the fetcher into a scanner, and the
  // bound survives. What is NOT fine is failing to record the attempt, so the
  // error is logged rather than swallowed: a ledger that quietly stops being
  // written is a rate limit that quietly stops existing.
  const { error: logError } = await admin
    .from("link_fetch_log")
    .insert({ user_id: userId });
  if (logError) {
    console.error("fetchLinkMetadata: rate-limit ledger insert failed", logError);
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
