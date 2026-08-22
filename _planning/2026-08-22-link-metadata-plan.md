# Link Metadata Auto-Fill — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Paste a product URL into the wishlist "Add item" form and have rybn fill in the title, description, price and image automatically.

**Architecture:** A Server Action fetches the pasted page through a dispatcher whose DNS lookup validates every resolved IP and pins the connection to the address it checked, then parses JSON-LD / Open Graph / Twitter metadata, ingests the image into the user's own storage folder, and returns optional fields the client applies only where the user has not typed.

**Tech Stack:** Next.js 16 App Router, TypeScript, `undici`, `ipaddr.js`, `node-html-parser`, Vitest (new), Supabase Storage, Clerk

**Spec:** `_planning/2026-08-22-link-metadata-design.md`

## Global Constraints

- Node `>=20.9.0` (from `package.json` engines).
- The page fetch and the image fetch are BOTH user-influenced and BOTH go through the same URL safety validation.
- Validation happens at the **resolved IP address**, never the hostname. The connection is pinned to the address that was validated.
- Storage upload uses the **user-scoped** client (`@/lib/supabase/server`) into `wishlist-images/<clerk user id>/`. **Never the service-role client on this path.**
- Storage buckets are private, limit `5242880` bytes, MIME allowlist `image/jpeg, image/png, image/gif, image/webp`. Verified live.
- The image column stores either an external URL or an object path; `resolveStoredImageValue()` in `lib/storage/image-value.ts` guards every write and requires a path to be in the writer's own folder.
- Price is accepted ONLY from structured sources (JSON-LD `offers.price`, `og:price:amount`). Never scraped from page text.
- A field the user has typed into is never overwritten.
- No failure blocks saving. No raw error text reaches the user.
- `npm run test:rls` must stay green (currently 11/11).
- `npm run lint` is broken repo-wide and pre-existing (Next 16 removed `next lint`); do not try to fix it, do not report it.

## Scope

**In scope:** the wishlist "Add item" form (`app/(dashboard)/wishlist/add/page.tsx`) only.

**Out of scope,** per the spec: editing an existing item, the gift tracker, and any third-party fallback service.

## File Structure

**Created:**
- `vitest.config.ts` — test runner config
- `lib/link-metadata/url-safety.ts` — pure URL/IP validation. The security boundary.
- `lib/link-metadata/url-safety.test.ts`
- `lib/link-metadata/safe-fetch.ts` — the guarded fetcher (dispatcher, redirects, limits)
- `lib/link-metadata/extract.ts` — pure HTML → metadata
- `lib/link-metadata/extract.test.ts`
- `lib/link-metadata/ingest-image.ts` — fetch, verify, upload
- `lib/actions/link-metadata.ts` — the Server Action
- `lib/storage/image-value.test.ts` — backfilled tests for the existing guard
- `supabase/migrations/20260825000000_link_fetch_log.sql` — rate-limit table

**Modified:**
- `package.json` — three dependencies, one script
- `app/(dashboard)/wishlist/add/page.tsx` — the client wiring

---

### Task 1: Vitest, and backfill the guard that already had no tests

This task delivers the runner AND closes a known gap. `resolveStoredImageValue()` is a security boundary shipped without tests because the repo had no way to run them.

**Files:**
- Create: `vitest.config.ts`, `lib/storage/image-value.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `npm run test` — runs Vitest once and exits non-zero on failure. Later tasks add files matching `**/*.test.ts`.

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest
```

- [ ] **Step 2: Add the config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
  resolve: {
    alias: { "@": resolve(__dirname, ".") },
  },
});
```

The `@` alias must match `tsconfig.json`'s paths, or every import in a test fails to resolve.

- [ ] **Step 3: Add the script**

In `package.json` `scripts`, add:

```json
"test": "vitest run"
```

- [ ] **Step 4: Write the failing test**

Create `lib/storage/image-value.test.ts`. These assertions encode the guarantees the storage work established — read `lib/storage/image-value.ts` first so the cases match its actual exports.

```ts
import { describe, expect, it } from "vitest";
import { resolveStoredImageValue, isOwnedStoragePath } from "@/lib/storage/image-value";

const ME = "user_2aaaaaaaaaaaaaaaaaaaaaaa";
const THEM = "user_2bbbbbbbbbbbbbbbbbbbbbbb";

describe("resolveStoredImageValue", () => {
  it("accepts my own object path", () => {
    const r = resolveStoredImageValue(`${ME}/123-abc.jpg`, ME);
    expect(r).toEqual({ ok: true, value: `${ME}/123-abc.jpg` });
  });

  it("rejects another user's object path", () => {
    const r = resolveStoredImageValue(`${THEM}/123-abc.jpg`, ME);
    expect(r.ok).toBe(false);
  });

  it("rejects traversal out of my folder", () => {
    expect(resolveStoredImageValue(`${ME}/../${THEM}/x.jpg`, ME).ok).toBe(false);
  });

  it("rejects a leading slash", () => {
    expect(resolveStoredImageValue(`/${ME}/x.jpg`, ME).ok).toBe(false);
  });

  it("rejects a folder that merely starts with my id", () => {
    expect(resolveStoredImageValue(`${ME}extra/x.jpg`, ME).ok).toBe(false);
  });

  it("normalises empty forms to null", () => {
    expect(resolveStoredImageValue("", ME)).toEqual({ ok: true, value: null });
    expect(resolveStoredImageValue(null, ME)).toEqual({ ok: true, value: null });
    expect(resolveStoredImageValue(undefined, ME)).toEqual({ ok: true, value: null });
  });

  it("accepts an external https URL", () => {
    const r = resolveStoredImageValue("https://example.com/a.jpg", ME);
    expect(r.ok).toBe(true);
  });

  it("rejects a URL on our own storage host, including a trailing dot", () => {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
    expect(resolveStoredImageValue(`https://${host}/storage/v1/object/sign/x`, ME).ok).toBe(false);
    expect(resolveStoredImageValue(`https://${host}./storage/v1/object/sign/x`, ME).ok).toBe(false);
  });
});

describe("isOwnedStoragePath", () => {
  it("is exact on the folder segment", () => {
    expect(isOwnedStoragePath(`${ME}/x.jpg`, ME)).toBe(true);
    expect(isOwnedStoragePath(`${ME.toUpperCase()}/x.jpg`, ME)).toBe(false);
  });
});
```

The storage-host test reads `NEXT_PUBLIC_SUPABASE_URL` from the environment. `.env.local` is not loaded by Vitest automatically — if the variable is undefined, load it in the config with `env: { ... }` or skip that one case explicitly rather than letting it throw a confusing `Invalid URL`.

- [ ] **Step 5: Run and watch it pass**

```bash
npm run test
```

Expected: all pass. These describe behaviour that already exists — if any fails, you have found a real defect in the shipped guard. **Stop and report it rather than editing the test to match.**

- [ ] **Step 6: Prove the tests can fail**

Temporarily change `isOwnedStoragePath`'s comparison from `===` to `.startsWith(`, run, and confirm the "merely starts with my id" case fails. Revert.

A test suite never seen failing proves nothing.

- [ ] **Step 7: Commit**

```bash
git add vitest.config.ts lib/storage/image-value.test.ts package.json package-lock.json
git commit -m "test: add Vitest and backfill the image-value guard

resolveStoredImageValue is a security boundary that shipped without tests
because the repo had no JavaScript runner. It has one now, and the guard is
covered before anything new is built on top of it."
```

---

### Task 2: URL safety — the security boundary

Pure functions, no I/O, hostile test corpus. This is the task where TDD genuinely earns its place: the whole security story of the feature is one function, and it is trivially testable.

**Files:**
- Create: `lib/link-metadata/url-safety.ts`, `lib/link-metadata/url-safety.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `isBlockedAddress(ip: string): boolean` — true when the IP must not be connected to.
- Produces: `parseSafeUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string }` — scheme and shape validation only; the IP check happens at connect time in Task 3.

- [ ] **Step 1: Install the IP parser**

```bash
npm install ipaddr.js
```

Hand-rolling CIDR arithmetic for a security boundary is how subtle bugs get in. `ipaddr.js` classifies addresses into named ranges and, critically, detects IPv4-mapped IPv6 — which is a real bypass of a naive check.

- [ ] **Step 2: Write the failing test**

Create `lib/link-metadata/url-safety.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isBlockedAddress, parseSafeUrl } from "@/lib/link-metadata/url-safety";

describe("isBlockedAddress", () => {
  const blocked = [
    "127.0.0.1", "127.1.2.3",           // loopback
    "10.0.0.1", "172.16.0.1", "192.168.1.1", // private
    "169.254.169.254",                   // cloud metadata
    "100.64.0.1",                        // carrier-grade NAT
    "0.0.0.0",
    "255.255.255.255",
    "224.0.0.1",                         // multicast
    "::1",                               // v6 loopback
    "::",                                // v6 unspecified
    "fc00::1", "fd12:3456::1",           // unique local
    "fe80::1",                           // v6 link-local
    "ff02::1",                           // v6 multicast
    "::ffff:169.254.169.254",            // IPv4-mapped metadata — the bypass
    "::ffff:127.0.0.1",
    "::ffff:a9fe:a9fe",                  // the SAME address, hex-compressed
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, () => expect(isBlockedAddress(ip)).toBe(true));
  }

  const allowed = ["1.1.1.1", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
  for (const ip of allowed) {
    it(`allows ${ip}`, () => expect(isBlockedAddress(ip)).toBe(false));
  }

  it("blocks anything unparseable", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("parseSafeUrl", () => {
  it("accepts http and https", () => {
    expect(parseSafeUrl("https://example.com/x").ok).toBe(true);
    expect(parseSafeUrl("http://example.com/x").ok).toBe(true);
  });

  const rejected = [
    "file:///etc/passwd",
    "data:text/html,hi",
    "javascript:alert(1)",
    "ftp://example.com/x",
    "gopher://example.com/x",
    "not a url",
    "",
  ];
  for (const raw of rejected) {
    it(`rejects ${raw || "(empty)"}`, () => expect(parseSafeUrl(raw).ok).toBe(false));
  }

  it("rejects embedded credentials", () => {
    expect(parseSafeUrl("https://user:pw@example.com/x").ok).toBe(false);
  });

  it("accepts a host that merely resembles a blocked one", () => {
    expect(parseSafeUrl("https://127.0.0.1.example.com/x").ok).toBe(true);
  });

  // The spec calls for decimal/octal/hex IP encodings. They are defended by the
  // URL parser normalising them, not by anything we wrote -- which is exactly
  // why it is worth asserting rather than assuming.
  it("normalises alternate IP encodings to a form isBlockedAddress catches", () => {
    for (const raw of ["http://2130706433/", "http://0177.0.0.1/", "http://0x7f.1/"]) {
      const r = parseSafeUrl(raw);
      expect(r.ok).toBe(true);
      expect((r as { url: URL }).url.hostname).toBe("127.0.0.1");
      expect(isBlockedAddress((r as { url: URL }).url.hostname)).toBe(true);
    }
  });

  it("normalises bracketed IPv4-mapped IPv6 to a blocked address", () => {
    const r = parseSafeUrl("http://[::ffff:169.254.169.254]/");
    expect(r.ok).toBe(true);
    // Note the brackets and the hex compression -- this is what the code really sees.
    const host = (r as { url: URL }).url.hostname.replace(/^\[|\]$/g, "");
    expect(host).toBe("::ffff:a9fe:a9fe");
    expect(isBlockedAddress(host)).toBe(true);
  });
});
```

`127.0.0.1.example.com` matters: it is a public hostname, and its safety is decided by what it RESOLVES to, not by how it reads. Blocking it by string match would be wrong.

- [ ] **Step 3: Run to verify it fails**

```bash
npm run test lib/link-metadata/url-safety.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/link-metadata/url-safety.ts`:

```ts
import ipaddr from "ipaddr.js";

/**
 * True when this address must never be connected to.
 *
 * Allowlist, not denylist: only `unicast` — a genuine public address — passes.
 * Every other range ipaddr.js knows about is refused, so a range we failed to
 * think of fails CLOSED rather than open.
 */
export function isBlockedAddress(ip: string): boolean {
  let parsed;
  try {
    parsed = ipaddr.parse(ip);
  } catch {
    return true; // unparseable is not connectable
  }

  // ::ffff:169.254.169.254 is a real bypass: as IPv6 its range is
  // "ipv4Mapped", which says nothing about the v4 address inside it.
  if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
    return isBlockedAddress((parsed as ipaddr.IPv6).toIPv4Address().toString());
  }

  return parsed.range() !== "unicast";
}

export function parseSafeUrl(
  raw: string
): { ok: true; url: URL } | { ok: false; reason: string } {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "That does not look like a web address." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https links can be read." };
  }

  // Credentials in a fetched URL are never wanted and are a known SSRF
  // confusion vector across parsers.
  if (url.username || url.password) {
    return { ok: false, reason: "That link cannot contain a username or password." };
  }

  return { ok: true, url };
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npm run test lib/link-metadata/url-safety.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Prove the IPv4-mapped case is load-bearing**

Delete the `isIPv4MappedAddress` branch, re-run, and confirm `::ffff:169.254.169.254` now fails the test. Restore it.

That branch is the difference between blocking the metadata endpoint and not.

- [ ] **Step 7: Commit**

```bash
git add lib/link-metadata/url-safety.ts lib/link-metadata/url-safety.test.ts package.json package-lock.json
git commit -m "feat: URL safety validation for link metadata

Allowlists genuine public unicast addresses rather than denylisting known-bad
ranges, so a range nobody thought of fails closed. Unmaps IPv4-mapped IPv6
before classifying, which is what stops ::ffff:169.254.169.254 reaching the
cloud metadata endpoint."
```

---

### Task 3: The guarded fetcher

**Files:**
- Create: `lib/link-metadata/safe-fetch.ts`

**Interfaces:**
- Consumes: `isBlockedAddress`, `parseSafeUrl` from Task 2.
- Produces: `safeFetch(raw: string, opts: { maxBytes: number; accept: string }): Promise<{ ok: true; body: Buffer; contentType: string } | { ok: false; reason: string }>`

- [ ] **Step 1: Install undici**

```bash
npm install undici
```

Node uses undici internally to implement global `fetch`, but does NOT expose it
as an importable module — `require("undici")` is `MODULE_NOT_FOUND` on this
machine, verified. An explicit dependency is the supported way to construct a
dispatcher. It is the same library `fetch` already runs on, so this adds an
entry to `package.json`, not a second HTTP stack.

- [ ] **Step 2: Implement**

Create `lib/link-metadata/safe-fetch.ts`:

```ts
import { Agent } from "undici";
import { lookup as dnsLookup } from "node:dns";
import { isBlockedAddress, parseSafeUrl } from "./url-safety";

const TIMEOUT_MS = 5_000;
const MAX_REDIRECTS = 3;

/**
 * A DNS lookup that refuses blocked addresses and hands back the ONE address it
 * validated.
 *
 * This is the whole SSRF defence, and it works because the address that gets
 * checked is the address that gets connected to. Validating the hostname
 * instead would be bypassed by DNS; validating a resolved address and then
 * letting the stack resolve again would be bypassed by DNS rebinding.
 */
const guardedLookup: typeof dnsLookup = ((hostname, options, callback) => {
  const cb = (typeof options === "function" ? options : callback) as
    (err: NodeJS.ErrnoException | null, address?: unknown, family?: number) => void;
  const opts = typeof options === "function" ? {} : options;

  dnsLookup(hostname, { ...(opts as object), all: true }, (err, addresses) => {
    if (err) return cb(err);
    const safe = (addresses as Array<{ address: string; family: number }>)
      .filter((a) => !isBlockedAddress(a.address));
    if (safe.length === 0) {
      return cb(Object.assign(new Error("BLOCKED_ADDRESS"), { code: "BLOCKED_ADDRESS" }));
    }
    if ((opts as { all?: boolean }).all) return cb(null, safe as unknown);
    return cb(null, safe[0].address, safe[0].family);
  });
}) as typeof dnsLookup;

const agent = new Agent({ connect: { lookup: guardedLookup } });

export async function safeFetch(
  raw: string,
  opts: { maxBytes: number; accept: string }
): Promise<{ ok: true; body: Buffer; contentType: string } | { ok: false; reason: string }> {
  let current = raw;

  // Redirects are followed by hand so every hop is re-validated. A public URL
  // that 302s to the metadata endpoint is the standard bypass.
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = parseSafeUrl(current);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };

    let res: Response;
    try {
      res = await fetch(parsed.url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { accept: opts.accept, "user-agent": "rybn-link-preview" },
        // @ts-expect-error -- undici option, not in the DOM fetch types
        dispatcher: agent,
      });
    } catch (e) {
      const code = (e as { cause?: { code?: string } })?.cause?.code;
      if (code === "BLOCKED_ADDRESS") {
        return { ok: false, reason: "That link points somewhere we will not fetch from." };
      }
      return { ok: false, reason: "We could not reach that page." };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { ok: false, reason: "We could not reach that page." };
      current = new URL(location, parsed.url).toString();
      continue;
    }

    if (!res.ok) return { ok: false, reason: "We could not read that page." };

    const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();

    // Cap while streaming. A declared content-length is not trusted and a
    // missing one is not a licence to read forever.
    const reader = res.body?.getReader();
    if (!reader) return { ok: false, reason: "We could not read that page." };
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > opts.maxBytes) {
        await reader.cancel();
        return { ok: false, reason: "That page is too large to read." };
      }
      chunks.push(value);
    }

    return { ok: true, body: Buffer.concat(chunks), contentType };
  }

  return { ok: false, reason: "That link redirects too many times." };
}
```

- [ ] **Step 3: Verify it compiles**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 4: Prove the block works, against a real address**

```bash
npx tsx -e "
import { safeFetch } from './lib/link-metadata/safe-fetch';
(async () => {
  console.log('metadata endpoint:', await safeFetch('http://169.254.169.254/latest/meta-data/', { maxBytes: 1000, accept: 'text/html' }));
  console.log('localhost:', await safeFetch('http://127.0.0.1/', { maxBytes: 1000, accept: 'text/html' }));
  console.log('public name -> loopback:', await safeFetch('http://localtest.me/', { maxBytes: 1000, accept: 'text/html' }));
  console.log('public:', (await safeFetch('https://example.com/', { maxBytes: 200000, accept: 'text/html' })).ok);
})();
"
```

Expected: the first three refuse with the "will not fetch from" reason; the last is `true`.

**`localtest.me` is the important one.** It is a genuine, publicly-resolvable
hostname whose DNS record points at `127.0.0.1`. Nothing about the string looks
private, so a hostname-based check would sail straight past it. It is refused
only because validation happens at the resolved address — which is the entire
claim this module makes, tested rather than assumed.

If `tsx` is unavailable, compile the module with `npx tsc` to a scratch directory outside the repo and run the JS. Do NOT add `tsx` as a dependency for this.

Record the actual output in your report — this is the single most important observation in the task.

- [ ] **Step 5: Commit**

```bash
git add lib/link-metadata/safe-fetch.ts package.json package-lock.json
git commit -m "feat: guarded fetcher for user-supplied URLs

Validates at the resolved address and pins the connection to the address it
validated, so neither DNS nor DNS rebinding gets past it. Redirects are
followed by hand so each hop is re-checked, and the body is capped while
streaming rather than trusting content-length."
```

---

### Task 4: Metadata extraction

Pure function over an HTML string. Fixtures, no network.

**Files:**
- Create: `lib/link-metadata/extract.ts`, `lib/link-metadata/extract.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `extractMetadata(html: string, pageUrl: string): { title?: string; description?: string; price?: number; imageUrl?: string }` — every field optional; partial success is the normal case. `imageUrl` is absolutised against `pageUrl`.

- [ ] **Step 1: Install the parser**

```bash
npm install node-html-parser
```

- [ ] **Step 2: Write the failing test**

Create `lib/link-metadata/extract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { extractMetadata } from "@/lib/link-metadata/extract";

const PAGE = "https://shop.example.com/p/1";

describe("extractMetadata", () => {
  it("prefers JSON-LD over Open Graph", () => {
    const html = `
      <html><head>
        <meta property="og:title" content="OG Title">
        <meta property="og:price:amount" content="99.00">
        <script type="application/ld+json">
          {"@type":"Product","name":"LD Title","offers":{"price":"42.50","priceCurrency":"USD"}}
        </script>
      </head></html>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("LD Title");
    expect(r.price).toBe(42.5);
  });

  it("falls back to Open Graph", () => {
    const html = `<html><head>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG Desc">
      <meta property="og:image" content="/img/a.jpg">
    </head></html>`;
    const r = extractMetadata(html, PAGE);
    expect(r.title).toBe("OG Title");
    expect(r.description).toBe("OG Desc");
    expect(r.imageUrl).toBe("https://shop.example.com/img/a.jpg");
  });

  it("falls back to twitter card, then document title", () => {
    expect(extractMetadata(
      `<html><head><meta name="twitter:title" content="TW"></head></html>`, PAGE
    ).title).toBe("TW");
    expect(extractMetadata(
      `<html><head><title>Doc</title></head></html>`, PAGE
    ).title).toBe("Doc");
  });

  it("never takes a price from page text", () => {
    const html = `<html><body><p>Only $19.99 today!</p></body></html>`;
    expect(extractMetadata(html, PAGE).price).toBeUndefined();
  });

  it("drops an unparseable price rather than guessing", () => {
    const html = `<html><head><meta property="og:price:amount" content="call us"></head></html>`;
    expect(extractMetadata(html, PAGE).price).toBeUndefined();
  });

  it("survives malformed JSON-LD", () => {
    const html = `<html><head>
      <script type="application/ld+json">{not json</script>
      <meta property="og:title" content="Still Works">
    </head></html>`;
    expect(extractMetadata(html, PAGE).title).toBe("Still Works");
  });

  it("finds Product inside an @graph array", () => {
    const html = `<html><head><script type="application/ld+json">
      {"@graph":[{"@type":"WebSite"},{"@type":"Product","name":"Graphed"}]}
    </script></head></html>`;
    expect(extractMetadata(html, PAGE).title).toBe("Graphed");
  });

  it("returns an empty object for a page with nothing", () => {
    expect(extractMetadata("<html><body>hi</body></html>", PAGE)).toEqual({});
  });
});
```

- [ ] **Step 3: Run to verify it fails**

```bash
npm run test lib/link-metadata/extract.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

Create `lib/link-metadata/extract.ts`:

```ts
import { parse } from "node-html-parser";

export interface LinkMetadata {
  title?: string;
  description?: string;
  price?: number;
  imageUrl?: string;
}

/** Only a finite, positive number is a price. "call us", NaN and 0 are not. */
function toPrice(raw: unknown): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) && raw > 0 ? raw : undefined;
  if (typeof raw !== "string") return undefined;
  const n = Number.parseFloat(raw.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function findProduct(node: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProduct(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!node || typeof node !== "object") return undefined;
  const obj = node as Record<string, unknown>;
  const type = obj["@type"];
  if (type === "Product" || (Array.isArray(type) && type.includes("Product"))) return obj;
  if (obj["@graph"]) return findProduct(obj["@graph"]);
  return undefined;
}

export function extractMetadata(html: string, pageUrl: string): LinkMetadata {
  const root = parse(html);
  const out: LinkMetadata = {};

  const meta = (selector: string) =>
    root.querySelector(selector)?.getAttribute("content")?.trim() || undefined;

  // 1. JSON-LD Product — the only source that reliably carries a real price.
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.rawText);
    } catch {
      continue; // a broken block must not lose us the rest of the page
    }
    const product = findProduct(parsed);
    if (!product) continue;

    if (typeof product.name === "string") out.title ??= product.name.trim();
    if (typeof product.description === "string") out.description ??= product.description.trim();

    const offers = Array.isArray(product.offers) ? product.offers[0] : product.offers;
    if (offers && typeof offers === "object") {
      out.price ??= toPrice((offers as Record<string, unknown>).price);
    }
    const image = Array.isArray(product.image) ? product.image[0] : product.image;
    if (typeof image === "string") out.imageUrl ??= image;
    break;
  }

  // 2. Open Graph, 3. Twitter card, 4. the document itself.
  out.title ??= meta('meta[property="og:title"]')
    ?? meta('meta[name="twitter:title"]')
    ?? root.querySelector("title")?.text?.trim() || undefined;

  out.description ??= meta('meta[property="og:description"]')
    ?? meta('meta[name="twitter:description"]')
    ?? meta('meta[name="description"]');

  out.price ??= toPrice(meta('meta[property="og:price:amount"]'));

  out.imageUrl ??= meta('meta[property="og:image"]') ?? meta('meta[name="twitter:image"]');

  // Absolutise, and drop anything that will not resolve.
  if (out.imageUrl) {
    try {
      out.imageUrl = new URL(out.imageUrl, pageUrl).toString();
    } catch {
      delete out.imageUrl;
    }
  }

  for (const k of Object.keys(out) as (keyof LinkMetadata)[]) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}
```

- [ ] **Step 5: Run to verify it passes**

```bash
npm run test lib/link-metadata/extract.test.ts
```

Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add lib/link-metadata/extract.ts lib/link-metadata/extract.test.ts package.json package-lock.json
git commit -m "feat: metadata extraction from page HTML

Reads JSON-LD, then Open Graph, then Twitter card, then the document. Price
comes only from structured sources -- a wrong price on a gift list is worse
than no price, so page text is never scraped for one."
```

---

### Task 5: Image ingestion

**Files:**
- Create: `lib/link-metadata/ingest-image.ts`

**Interfaces:**
- Consumes: `safeFetch(raw, { maxBytes: number; acceptHeader: string })` from
  Task 3, returning
  `{ ok: true; body: Buffer; contentType: string | null } | { ok: false; reason: string }`.
  Note `acceptHeader`, not `accept`: it is a request hint and is NOT enforced
  against the response, so the name says so. This module is right to ignore
  `contentType` entirely and trust magic bytes instead.
- Produces: `ingestImage(imageUrl: string, userId: string, supabase: SupabaseClient<Database>): Promise<string | null>` — returns the stored object path, or `null` on any failure. **Never throws**; a missing image must not lose the text metadata.

- [ ] **Step 1: Implement**

Create `lib/link-metadata/ingest-image.ts`:

```ts
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { safeFetch } from "./safe-fetch";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // matches the bucket's file_size_limit
const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

/** Magic bytes. The declared content-type is attacker-influenced; this is not. */
function sniff(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.length >= 6 && (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a")) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

export async function ingestImage(
  imageUrl: string,
  userId: string,
  supabase: SupabaseClient<Database>
): Promise<string | null> {
  const fetched = await safeFetch(imageUrl, {
    maxBytes: MAX_IMAGE_BYTES,
    acceptHeader: "image/*",
  });
  if (!fetched.ok) return null;

  // Trust the bytes, not the header.
  const actual = sniff(fetched.body);
  if (!actual || !ALLOWED.has(actual)) return null;

  // Same folder convention as a manual upload, which is what the storage
  // INSERT policy requires: (storage.foldername(name))[1] = requesting_user_id().
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).substring(2)}.${ALLOWED.get(actual)}`;

  const { error } = await supabase.storage
    .from("wishlist-images")
    .upload(path, fetched.body, { contentType: actual, cacheControl: "3600" });

  if (error) return null;
  return path;
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run type-check
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add lib/link-metadata/ingest-image.ts
git commit -m "feat: ingest a page's image into the user's own storage folder

Goes through the same URL safety validation as the page fetch, sniffs magic
bytes rather than trusting the declared content-type, and uploads through the
user-scoped client so it satisfies the same folder-scoped policy as a manual
upload. Returns null rather than throwing -- a missing image must not cost us
the text."
```

---

### Task 6: The Server Action and its rate limit

**Files:**
- Create: `supabase/migrations/20260825000000_link_fetch_log.sql`, `lib/actions/link-metadata.ts`
- Modify: `supabase/tests/rls/MANIFEST`, and one test file (see Step 3)

**Interfaces:**
- Consumes: `safeFetch(raw, { maxBytes: number; acceptHeader: string })` from
  Task 3, returning
  `{ ok: true; body: Buffer; contentType: string | null } | { ok: false; reason: string }`;
  `extractMetadata`; `ingestImage`.
- Produces: `fetchLinkMetadata(url: string): Promise<{ title?: string; description?: string; price?: number; imagePath?: string; error?: string }>` — a Server Action. Task 7 calls this.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260825000000_link_fetch_log.sql`:

```sql
-- Rate-limit ledger for the link-preview fetcher.
--
-- Even with SSRF closed, an authenticated user can aim the fetcher at arbitrary
-- public hosts and use rybn as a scanner. This bounds that.
--
-- RLS is enabled with NO policies, so anon and authenticated can do nothing at
-- all. Only the service role touches it, and only from the server action. It
-- holds no user content -- an id and a timestamp -- so there is nothing here
-- for a user to legitimately read.
create table public.link_fetch_log (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.user_profiles(id) on delete cascade,
  fetched_at timestamptz not null default now()
);

create index idx_link_fetch_log_user_time on public.link_fetch_log (user_id, fetched_at desc);

alter table public.link_fetch_log enable row level security;

revoke all on public.link_fetch_log from anon, authenticated;
```

- [ ] **Step 2: Apply it**

```bash
npx --yes supabase@latest db push --linked
```

NOT `db reset` — the baseline is already applied.

- [ ] **Step 3: Extend the anon-reach test**

`supabase/tests/rls/06_anon_has_no_reach.sql` asserts anon has no reach and that every table has RLS on. A new table must be covered by it — read the file first and follow its existing assertion style exactly.

The harness rejects, before any SQL runs, a file that: is not declared in MANIFEST; lacks the counter-gated pattern; does not initialise `v_checks int := 0`; has an `if v_checks < N` floor that is not EXACTLY the increment count; does not insert its token inside the guarded region; does not end with exactly `select token as result from _harness_result;`; or contains an exception handler or transaction control.

**Two blind spots no automated check catches — avoid both by construction:** never write an `exception` handler (a multi-line `exception` / `when` slips past the check and silently swallows failing assertions), and increment only with a plain `v_checks := v_checks + 1;`.

Add these two assertions inside the guarded region, before the token insert:

```sql
  if not exists (
    select 1 from pg_tables
    where schemaname = 'public' and tablename = 'link_fetch_log' and rowsecurity
  ) then
    raise exception 'link_fetch_log does not have RLS enabled';
  end if;
  v_checks := v_checks + 1;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'link_fetch_log'
  ) then
    raise exception 'link_fetch_log must have no policies -- it is service-role only';
  end if;
  v_checks := v_checks + 1;
```

Then raise the `if v_checks < N` floor by **exactly 2**. The harness fails the
file if the floor and the increment count disagree, so this is not optional
bookkeeping.

The file also snapshots public-schema relations to catch leaks. If it lists
tables explicitly, `link_fetch_log` must be added there too, or the suite will
fail with an unexpected-relation error — which is the check doing its job.

- [ ] **Step 4: Run the suite**

```bash
npm run test:rls
```

Expected: 11 files pass, with your new assertion included.

- [ ] **Step 5: Write the action**

Create `lib/actions/link-metadata.ts`:

```ts
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
  await admin.from("link_fetch_log").insert({ user_id: userId });

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
```

- [ ] **Step 6: Verify**

```bash
npm run type-check && npm run build
```

Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260825000000_link_fetch_log.sql supabase/tests/rls lib/actions/link-metadata.ts
git commit -m "feat: link metadata server action with a per-user rate limit

The ledger is service-role only: it holds a user id and a timestamp, nothing a
user needs to read, and nothing they should be able to trim. Image ingestion is
best-effort so a blocked image never costs us the title and price."
```

---

### Task 7: Client wiring — fill, but never clobber

**Files:**
- Modify: `app/(dashboard)/wishlist/add/page.tsx`

**Interfaces:**
- Consumes: `fetchLinkMetadata` from Task 6.

- [ ] **Step 1: Read the form first**

The file currently imports only `useState` from React. This task also needs
`useEffect` and `useRef`.

`app/(dashboard)/wishlist/add/page.tsx` uses `react-hook-form` with `zodResolver(wishlistItemSchema)`. It already destructures `register`, `handleSubmit`, `watch` and `setValue`. You will also need `formState.dirtyFields` — that is what makes "never clobber" enforceable rather than aspirational.

- [ ] **Step 2: Add the fetch-on-paste effect**

Add to the component. Watch the `url` field, debounce, and call the action:

```tsx
const urlValue = watch("url");
const [isFetchingMeta, setIsFetchingMeta] = useState(false);
const [metaNote, setMetaNote] = useState<string | null>(null);
const lastFetchedUrl = useRef<string | null>(null);

useEffect(() => {
  const raw = (urlValue ?? "").trim();
  if (!raw || raw === lastFetchedUrl.current) return;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
  } catch {
    return; // still typing
  }

  const timer = setTimeout(async () => {
    lastFetchedUrl.current = raw;
    setIsFetchingMeta(true);
    setMetaNote(null);
    const result = await fetchLinkMetadata(raw);
    setIsFetchingMeta(false);

    if (result.error) {
      setMetaNote(result.error);
      return;
    }

    // Fill only what the user has neither typed into nor already filled.
    // dirtyFields is the record of what they touched; a slow fetch must never
    // pull text out from under someone mid-sentence.
    //
    // Read through the ref, not the closure: dirtyFields is a fresh object on
    // every formState update, so depending on it directly would restart the
    // debounce timer on each keystroke anywhere in the form.
    const fill = <K extends "title" | "description" | "price" | "image_url">(
      field: K,
      value: string | number | undefined
    ) => {
      if (value === undefined) return;
      if (dirtyRef.current[field]) return;
      if (getValues(field)) return;
      setValue(field, value as never, { shouldValidate: true });
    };

    fill("title", result.title);
    fill("description", result.description);
    fill("price", result.price);
    fill("image_url", result.imagePath);

    if (!result.title && !result.description && !result.price && !result.imagePath) {
      setMetaNote("We could not read any details from that page — fill them in below.");
    }
  }, 600);

  return () => clearTimeout(timer);
}, [urlValue, getValues, setValue]);
```

Declare the ref above that effect. This is the same pattern
`lib/supabase/use-supabase.ts` uses to read a changing value without
re-memoising on it:

```tsx
const dirtyRef = useRef(dirtyFields);
dirtyRef.current = dirtyFields;
```

Destructuring `dirtyFields` is still required even though the effect reads the
ref — `formState` is a Proxy, and RHF only tracks the fields you actually
destructure. Drop it and `dirtyFields` silently stays empty, which would
disable the never-clobber rule while looking like it works.

Add `dirtyFields` and `getValues` to the `useForm` destructure:

```tsx
const {
  register,
  handleSubmit,
  formState: { errors, dirtyFields },
  watch,
  setValue,
  getValues,
} = useForm<WishlistItemFormData>({ /* unchanged */ });
```

- [ ] **Step 3: Show the state**

Near the URL field, render the loading and note states. Keep it quiet — this must never look like an error that blocks saving:

```tsx
{isFetchingMeta && (
  <Text className="text-sm text-gray-500 mt-1">Reading that page…</Text>
)}
{metaNote && !isFetchingMeta && (
  <Text className="text-sm text-gray-500 mt-1">{metaNote}</Text>
)}
```

- [ ] **Step 4: Verify**

```bash
npm run type-check && npm run build && npm run test && npm run test:rls
```

Expected: all four pass.

- [ ] **Step 5: Exercise it in a browser**

Start the dev server and sign in. This is the only step that tests the feature as a user meets it:

- Paste a URL from a site with good Open Graph data (a Wikipedia article works, and is not bot-blocked). Confirm the title fills.
- Type a title FIRST, then paste a URL. **Confirm your title survives.** This is the never-clobber rule and it is the thing most likely to be subtly wrong.
- Paste a URL from a large retailer. Confirm it degrades to a quiet note and the form is still fillable.
- Paste `http://169.254.169.254/latest/meta-data/`. Confirm it refuses.
- Confirm saving works with a fetch in flight, after a failure, and with no URL at all.

Record what you actually observed. If you cannot drive a browser, say so plainly rather than implying you did.

- [ ] **Step 6: Commit**

```bash
git add "app/(dashboard)/wishlist/add/page.tsx"
git commit -m "feat: fill wishlist fields from a pasted URL

Fills only fields that are both empty and untouched, read from react-hook-form's
dirtyFields, so a slow fetch cannot pull text out from under someone
mid-sentence. Failures are a quiet note and never block saving."
```

---

## Verification

The whole feature is done when:

- `npm run test` passes (URL safety, extraction, and the backfilled image-value guard).
- `npm run test:rls` passes with the new `link_fetch_log` assertion.
- `npm run type-check` and `npm run build` pass.
- `http://169.254.169.254/…`, `http://127.0.0.1/` and `http://10.0.0.1/` are all refused, verified by execution, including via a redirect.
- A typed field survives a paste.
- A blocked retailer degrades quietly and the form still saves.
