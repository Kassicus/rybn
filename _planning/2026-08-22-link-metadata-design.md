# Link Metadata Auto-Fill — Design

**Date:** 2026-08-22
**Status:** Approved, pending implementation plan

## Overview

Paste a product URL into the wishlist "Add item" form and have rybn populate
the title, description, price and image automatically.

The form already carries every field this fills — `title`, `description`,
`url`, `price`, `category` — plus an image. So this adds a data source, not a
data model.

## Decisions

| Decision | Choice | Rejected |
|---|---|---|
| What happens to the page's image | Fetch once and copy into our storage bucket | Hotlink the remote URL; hotlink with manual upload as fallback |
| How the page is read | Self-hosted fetch and parse | Third-party preview API; self-hosted with a paid fallback |
| When it runs, and what it may overwrite | Automatically on paste, filling only fields that are empty AND untouched | Auto-fill everything; explicit "Fetch details" button |
| Testing | Add Vitest | Ship the SSRF validator untested |
| Rate limiting | Per-user throttle | None |

**Why copy the image rather than link it.** A wishlist sits for months before a
birthday. A hotlinked image breaks when the retailer rotates their CDN or pulls
the product, hotlinking is frequently blocked outright, and every viewer's
browser would tell that retailer someone is looking — which leaks a little about
who is shopping for what. Copying also means the existing private-bucket and
signed-URL machinery carries this feature unchanged.

**Why self-hosted rather than a preview API.** The URLs are gifts. Sending every
product a user saves to a third party discloses who is buying what for whom,
which matters more in this app than in most. The cost is honest: large retailers
block datacenter IPs, so Amazon, Target and Walmart will often return a bot page
and the user will fill those in by hand. That degrades gracefully, and a
fallback service can be added later without rework.

**Why never clobber.** A slow fetch that yanks text out from under someone
mid-sentence is the classic way this feature becomes annoying. `react-hook-form`
already tracks `dirtyFields`, so "only fill what the user has not touched" is
enforceable rather than aspirational.

## Scope

**In scope:** the wishlist "Add item" form only.

**Explicitly out of scope, and each would be its own change:**

- **Editing an existing item.** Re-fetching on edit raises questions this design
  does not answer — whether a changed URL should re-pull, and what happens to
  fields the user has since curated. The never-clobber rule was designed for a
  blank form; it is not obviously the right rule for an edit.
- **The gift tracker** (`tracked_gifts`, `gift-photos`). The same machinery
  would apply, but the flows differ and the bucket differs. Adding it later is
  a small change; conflating it now doubles the surface being reviewed.
- **A fallback preview service** for retailers that block us. Recorded as the
  known cost of the self-hosted choice, not a gap to close in this pass.

## Constraints

- Node >= 20.9.0; Next.js 16 App Router; the fetch runs in a Server Action.
- Identity is Clerk; the storage upload must go through the **user-scoped**
  Supabase client so it satisfies the same folder-scoped INSERT policy as a
  manual upload. **No service-role key on this path.**
- Storage buckets are private with a 5 MB limit and an image MIME allowlist.
  The stored value is an object **path**, and existing server actions sign it on
  the way out. This feature produces a path exactly like an upload does, so
  everything downstream is unchanged.
- `resolveStoredImageValue()` guards writes to the image column: a stored path
  must live in the writer's own folder. A fetched image satisfies this by
  construction, since we upload it into that folder.
- There is **no JavaScript test runner in the repo today**.

## Architecture

### 1. URL safety — the security core

A server that fetches user-supplied URLs is the classic SSRF hole. On Vercel the
prize is the cloud metadata endpoint at `169.254.169.254`.

**Validation must happen at the resolved IP address, not the hostname.**
Hostname checks are bypassed by pointing DNS at a private address.

Requirements:

- **Scheme allowlist:** `http:` and `https:` only. Reject `file:`, `data:`,
  `gopher:`, `ftp:`, and everything else.
- **Custom DNS lookup hook.** Node's `fetch` (undici) accepts a dispatcher whose
  `connect` options take a `lookup` function. Validate every resolved address
  there and **pin the connection to the address just validated** — this is also
  what closes DNS rebinding, because the address that was checked is the address
  that gets connected to.
- **Blocked IPv4 ranges:** `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT),
  `127/8`, `169.254/16` (link-local — the metadata endpoint), `172.16/12`,
  `192.0.0/24`, `192.0.2/24`, `192.88.99/24`, `192.168/16`, `198.18/15`,
  `198.51.100/24`, `203.0.113/24`, `224/4` (multicast), `240/4` (reserved),
  `255.255.255.255`.
- **Blocked IPv6:** `::1`, `::`, `fc00::/7` (unique local), `fe80::/10`
  (link-local), `ff00::/8` (multicast), `2001:db8::/32`, `64:ff9b::/96` (NAT64).
- **IPv4-mapped IPv6 must be unmapped and re-checked.** `::ffff:169.254.169.254`
  is a real bypass of a naive IPv6-only check.
- **Re-validate after every redirect.** A public URL that 302s to the metadata
  endpoint is the standard bypass, so redirects cannot be followed blindly.
- **Limits:** short connect and total timeout, a response size cap, a low
  maximum redirect count, no credentials and no cookies forwarded.

Failure mode is reject. An input that cannot be parsed or resolved is refused,
never fetched.

### 2. Extraction

Read in descending order of confidence, taking the first usable value per field:

1. **JSON-LD** — `<script type="application/ld+json">` containing a schema.org
   `Product`. Structured, and the only source that reliably carries price with a
   currency.
2. **Open Graph** — `og:title`, `og:description`, `og:image`,
   `og:price:amount` / `og:price:currency`.
3. **Twitter card** — `twitter:title`, `twitter:description`, `twitter:image`.
4. **Document floor** — `<title>` and `<meta name="description">`.

**Price is accepted only from structured sources** (JSON-LD `offers.price` or
`og:price:amount`), never scraped from page text. A wrong price on a gift list
is worse than no price. Currency mismatches are dropped rather than guessed.

Parsing uses `node-html-parser` — this needs meta tags and script blocks only,
and it is a fraction of `cheerio`'s weight.

### 3. Image ingestion

The extracted image URL is user-influenced, so it goes through **the same URL
safety validation** as the page fetch. Then:

- Content-type allowlist matching the bucket's MIME allowlist.
- Size cap matching the bucket's 5 MB limit, enforced while streaming rather
  than after.
- **Magic-bytes check** — the declared content type is not trusted.
- Upload through the user-scoped client into `wishlist-images/<clerk user id>/`,
  satisfying the existing folder-scoped INSERT policy.
- Store the returned path in `wishlist_items.image_url` — the column holds
  either a storage path or an external URL, and an ingested image produces a
  path, exactly as a manual upload does.

### 4. Interaction

- The `url` field triggers a debounced call to a Server Action once its value
  parses as a valid http(s) URL.
- The action returns `{ title?, description?, price?, imagePath? }` — every
  field optional, because partial success is the normal case.
- The client fills a field only when it is **both empty and untouched**, read
  from `react-hook-form`'s `dirtyFields`.
- Fields being populated show a quiet loading state.
- Saving is never blocked by a fetch in flight or a fetch that failed.

### 5. Failure handling

Failures are expected, not exceptional. Every case leaves the user able to type
the details themselves:

| Case | Behaviour |
|---|---|
| Timeout, bot page, or no metadata found | Quiet inline note: could not read that page |
| Blocked by URL safety validation | Distinct message — this is a refusal, not a failure |
| Image fetch fails but text succeeded | Keep the text, skip the image, say so |
| Rate limit reached | Tell the user to try again shortly |

No failure blocks saving, and no failure surfaces a raw error to the user.

### 6. Rate limiting

Even with SSRF closed, an authenticated user can aim rybn at arbitrary hosts and
use it as a scanner. A per-user throttle bounds this. It must be durable rather
than in-process, because serverless functions do not share memory.

## Testing

**This adds Vitest, which the repo does not currently have.**

The SSRF validator is a pure function whose correctness *is* the security
boundary, and it cannot be covered by the existing SQL harness. This gap has now
appeared twice: `resolveStoredImageValue()` from the storage work has the same
shape and could only be verified by compiling it in a throwaway script.

- **Vitest** covers the URL validator and the metadata parser — both pure
  functions with adversarial inputs and no I/O.
- The URL validator gets a hostile corpus: every blocked range, IPv4-mapped
  IPv6, decimal/octal/hex IP encodings, redirect chains ending at a blocked
  address, credentials in the URL, non-http schemes, and hosts that merely
  resemble a blocked one.
- **Backfill a test for `resolveStoredImageValue()`** while the runner is being
  added — it is the same class of untested security boundary.
- The existing `npm run test:rls` suite is untouched and must stay green.

## Success criteria

- Pasting a URL from a site with good Open Graph or JSON-LD data fills title,
  description, price and image without further typing.
- A field the user has already typed into is never overwritten.
- The image is stored in the user's own folder and renders through the existing
  signed-URL path.
- A URL resolving to a private, loopback, link-local or IPv4-mapped-private
  address is refused, including after a redirect.
- A blocked retailer degrades to a quiet note and a manually fillable form.
- Saving works with the fetch in flight, failed, or never triggered.
- `npm run test:rls` stays green; `npm run type-check` and `npm run build` pass.

## Risks

**The SSRF validator is the whole security story.** It is one pure function, it
is testable, and it must be tested hostilely. Everything else in this design is
recoverable; this is not.

**Coverage will disappoint on the largest retailers.** That is inherent to the
self-hosted choice and was accepted knowingly. The failure must be quiet and the
manual path must stay obvious.

**Price is the most dangerous field to get wrong** — hence structured sources
only. A missing price is a small annoyance; a wrong one misleads someone buying
a gift.

**Rate limiting is the weakest part of this design.** It bounds abuse rather
than preventing it. Acceptable because the endpoint is authenticated and the
audience is small, but it should be revisited if either changes.
