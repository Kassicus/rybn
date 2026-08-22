import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { isOwnedStoragePath, isStorageObjectPath } from "@/lib/storage/image-value";

/**
 * What is real here and what is not.
 *
 * The two decisions this module makes on its own -- what the bytes are, and
 * where the object goes -- are pure, and are tested against the real functions.
 *
 * The two things it delegates are not testable here for opposite reasons.
 * `safeFetch` is exercised for real by `safe-fetch.test.ts` against loopback
 * servers, and re-running that here would test undici twice and this module
 * zero times; what IS this module's business is that it delegates at all, and
 * with what arguments, so the module boundary is mocked and the call is
 * asserted. Supabase Storage needs a live bucket, a live Clerk token and a live
 * RLS policy, none of which exist in this process, so the client is a fake that
 * records what it was handed. That fake proves the arguments; it cannot prove
 * the policy accepts them. See the report for what that leaves unverified.
 */

const fetchControl = vi.hoisted(() => ({
  impl: null as
    | ((raw: string, opts: unknown) => Promise<unknown> | unknown)
    | null,
  calls: [] as Array<{ raw: string; opts: unknown }>,
}));

vi.mock("./safe-fetch", () => ({
  safeFetch: async (raw: string, opts: unknown) => {
    fetchControl.calls.push({ raw, opts });
    if (!fetchControl.impl) {
      throw new Error("test bug: no safeFetch behaviour configured");
    }
    return fetchControl.impl(raw, opts);
  },
}));

const { ingestImage, __testing } = await import("./ingest-image");
const { sniff, buildObjectPath, MAX_IMAGE_BYTES, ALLOWED } = __testing;

const USER_ID = "user_2abcDEF456ghiJKL";

// ---------------------------------------------------------------------------
// Fixtures: the first bytes of each format we accept, and of things we do not.
// ---------------------------------------------------------------------------

/** JFIF-flavoured JPEG: SOI, then the APP0 marker. */
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
/** PNG signature followed by the start of the IHDR chunk. */
const PNG = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52,
]);
const GIF87 = Buffer.concat([
  Buffer.from("GIF87a", "latin1"),
  Buffer.from([0x01, 0x00, 0x01, 0x00]),
]);
const GIF89 = Buffer.concat([
  Buffer.from("GIF89a", "latin1"),
  Buffer.from([0x01, 0x00, 0x01, 0x00]),
]);
/** RIFF container, length word, then the WEBP form tag and a VP8 chunk. */
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0x1a, 0x00, 0x00, 0x00]),
  Buffer.from("WEBPVP8 ", "latin1"),
]);

const ACCEPTED: Array<[string, Buffer, string]> = [
  ["jpeg", JPEG, "image/jpeg"],
  ["png", PNG, "image/png"],
  ["gif87a", GIF87, "image/gif"],
  ["gif89a", GIF89, "image/gif"],
  ["webp", WEBP, "image/webp"],
];

// ---------------------------------------------------------------------------
// A Supabase client that records instead of uploading.
// ---------------------------------------------------------------------------

type UploadCall = {
  bucket: string;
  path: string;
  body: unknown;
  options: Record<string, unknown> | undefined;
};

function fakeSupabase(
  result: { error: unknown } | (() => never) = { error: null }
) {
  const uploads: UploadCall[] = [];
  const client = {
    storage: {
      from(bucket: string) {
        return {
          upload(
            path: string,
            body: unknown,
            options?: Record<string, unknown>
          ) {
            uploads.push({ bucket, path, body, options });
            if (typeof result === "function") return result();
            return Promise.resolve({ data: { path }, ...result });
          },
        };
      },
    },
  };
  return {
    uploads,
    client: client as unknown as SupabaseClient<Database>,
  };
}

/** Configure the mocked fetcher to hand back a body. */
function respondWith(body: Buffer, contentType: string | null = null) {
  fetchControl.impl = () => ({ ok: true, body, contentType });
}

beforeEach(() => {
  fetchControl.impl = null;
  fetchControl.calls.length = 0;
});

// ---------------------------------------------------------------------------
describe("sniff: the content type comes from the bytes", () => {
  it.each(ACCEPTED)("recognises %s", (_name, bytes, expected) => {
    expect(sniff(bytes)).toBe(expected);
  });

  it("only ever names a type the bucket accepts", () => {
    // A type sniffed but not in ALLOWED would upload and then be refused
    // server-side. This keeps the two lists from drifting apart.
    for (const [, bytes] of ACCEPTED) {
      const type = sniff(bytes);
      expect(type).not.toBeNull();
      expect(ALLOWED.has(type!)).toBe(true);
    }
    expect([...ALLOWED.keys()].sort()).toEqual([
      "image/gif",
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
  });

  it.each([
    ["empty", Buffer.alloc(0)],
    ["one byte of a JPEG", Buffer.from([0xff])],
    ["SOI without a marker", Buffer.from([0xff, 0xd8])],
    ["a truncated PNG signature", PNG.subarray(0, 7)],
    ["a PNG signature with one bit flipped", flip(PNG, 3)],
    ["GIF88a", Buffer.from("GIF88a....", "latin1")],
    ["a truncated GIF tag", Buffer.from("GIF87", "latin1")],
    ["RIFF/WAVE", riff("WAVE")],
    ["RIFF/AVI ", riff("AVI ")],
    ["RIFF truncated before the form tag", riff("WEBP").subarray(0, 11)],
    ["HTML", Buffer.from("<!DOCTYPE html><html><body>hi", "latin1")],
    ["SVG", Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>', "latin1")],
    ["a PDF", Buffer.from("%PDF-1.7\n%\xe2\xe3\xcf\xd3", "latin1")],
    ["a shell script", Buffer.from("#!/bin/sh\nrm -rf /\n", "latin1")],
    ["a BMP", Buffer.from([0x42, 0x4d, 0x36, 0x00, 0x00, 0x00, 0x00, 0x00])],
    ["a TIFF", Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])],
    ["an ICO", Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20])],
    ["a ZIP", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00])],
  ])("refuses %s", (_name, bytes) => {
    expect(sniff(bytes)).toBeNull();
  });

  /**
   * The mutation this file exists for.
   *
   * The obvious way to write the GIF and WebP checks is
   * `buf.subarray(0, 6).toString("ascii") === "GIF87a"`. Node's `ascii` decoder
   * masks the high bit, so 64 different byte strings decode to `"GIF87a"` and
   * that check accepts every one of them. The two assertions below are the
   * proof: the mutant accepts the spoof, the real function refuses it. Without
   * the first assertion the second is just another passing test with nothing
   * behind it.
   */
  describe("the high-bit spoof that an ascii comparison would let through", () => {
    const GIF_SPOOF = Buffer.from([0xc7, 0xc9, 0xc6, 0xb8, 0xb7, 0xe1, 0x00]);
    const WEBP_SPOOF = Buffer.from([
      0xd2, 0xc9, 0xc6, 0xc6, 0x00, 0x00, 0x00, 0x00, 0xd7, 0xc5, 0xc2, 0xd0,
    ]);

    /** The implementation this module deliberately does not have. */
    function asciiMutant(buf: Buffer): string | null {
      if (
        buf.length >= 6 &&
        (buf.subarray(0, 6).toString("ascii") === "GIF87a" ||
          buf.subarray(0, 6).toString("ascii") === "GIF89a")
      ) {
        return "image/gif";
      }
      if (
        buf.length >= 12 &&
        buf.subarray(0, 4).toString("ascii") === "RIFF" &&
        buf.subarray(8, 12).toString("ascii") === "WEBP"
      ) {
        return "image/webp";
      }
      return null;
    }

    it("the mutant really is fooled -- so this test can fail", () => {
      expect(asciiMutant(GIF_SPOOF)).toBe("image/gif");
      expect(asciiMutant(WEBP_SPOOF)).toBe("image/webp");
      // ...and it agrees with the real one on genuine input, so the two differ
      // only on the spoof.
      expect(asciiMutant(GIF89)).toBe("image/gif");
      expect(asciiMutant(WEBP)).toBe("image/webp");
    });

    it("sniff is not", () => {
      expect(sniff(GIF_SPOOF)).toBeNull();
      expect(sniff(WEBP_SPOOF)).toBeNull();
    });

    it("refuses every high-bit variant of the GIF tag, not just that one", () => {
      // 2^6 - 1 spoofings of "GIF87a": each subset of the six bytes with the
      // high bit set. All of them decode to "GIF87a" under `ascii`.
      const base = Buffer.from("GIF87a", "latin1");
      let checked = 0;
      for (let mask = 1; mask < 64; mask++) {
        const spoof = Buffer.from(base);
        for (let bit = 0; bit < 6; bit++) {
          if (mask & (1 << bit)) spoof[bit] |= 0x80;
        }
        expect(spoof.toString("ascii")).toBe("GIF87a");
        expect(sniff(Buffer.concat([spoof, Buffer.alloc(6)]))).toBeNull();
        checked++;
      }
      expect(checked).toBe(63);
    });
  });
});

// ---------------------------------------------------------------------------
describe("buildObjectPath: the folder the storage policy requires", () => {
  it("puts the object in the user's own folder", () => {
    const path = buildObjectPath(USER_ID, "png");
    expect(path.split("/")[0]).toBe(USER_ID);
    expect(path.endsWith(".png")).toBe(true);
  });

  it("produces a value the write guard will accept", () => {
    // If these disagree, ingestImage uploads objects that can never be stored
    // in a row -- orphans in the bucket and a lost image with no error.
    for (const ext of ALLOWED.values()) {
      const path = buildObjectPath(USER_ID, ext);
      expect(isStorageObjectPath(path)).toBe(true);
      expect(isOwnedStoragePath(path, USER_ID)).toBe(true);
    }
  });

  it("does not collide across rapid calls", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(buildObjectPath(USER_ID, "jpg"));
    expect(seen.size).toBe(2000);
  });

  it("is still policy-shaped when Math.random() returns its floor", () => {
    // (0).toString(36).substring(2) is "", which is the degenerate case the
    // shared random-suffix idiom has. The path must still be legal.
    const spy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const path = buildObjectPath(USER_ID, "gif");
      expect(isOwnedStoragePath(path, USER_ID)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses to claim a foreign folder for a foreign-looking id", () => {
    // Not a case a real caller can reach -- userId comes from the session --
    // but it is what the isOwnedStoragePath check in ingestImage catches.
    for (const bad of ["", "a/b", "/", "..", "../other"]) {
      expect(isOwnedStoragePath(buildObjectPath(bad, "png"), bad)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("ingestImage: what it asks for", () => {
  it("fetches the image through safeFetch, at the bucket's own limit", async () => {
    respondWith(PNG);
    const { client } = fakeSupabase();
    await ingestImage("https://example.com/a.png", USER_ID, client);

    expect(fetchControl.calls).toHaveLength(1);
    expect(fetchControl.calls[0].raw).toBe("https://example.com/a.png");
    expect(fetchControl.calls[0].opts).toEqual({
      maxBytes: MAX_IMAGE_BYTES,
      acceptHeader: "image/*",
    });
    // Verified live against the bucket's file_size_limit.
    expect(MAX_IMAGE_BYTES).toBe(5242880);
  });

  it("hands safeFetch the URL verbatim, including a hostile one", async () => {
    // Task 4 does NOT validate the image URL it extracts. Passing it through
    // unchanged is what lets safeFetch judge it; "cleaning it up" first, or
    // resolving it first, is how that judgement gets bypassed.
    // The refusal carries a perfectly good PNG. It must still be a refusal:
    // this is what makes the test fail against an implementation that reads
    // `body` without first reading `ok` -- against a bare `{ ok: false }` such
    // an implementation would crash into the catch and return null anyway,
    // which is the right answer for the wrong reason.
    fetchControl.impl = () => ({ ok: false, reason: "refused", body: PNG });
    const { client, uploads } = fakeSupabase();
    const hostile = "http://169.254.169.254/latest/meta-data/";
    expect(await ingestImage(hostile, USER_ID, client)).toBeNull();
    expect(fetchControl.calls[0].raw).toBe(hostile);
    expect(uploads).toHaveLength(0);
  });

  it("has no way to fetch except through safeFetch", async () => {
    // The one invariant a mocked fetcher cannot prove by mocking. If a future
    // edit reaches for global fetch or an http client directly, the extracted
    // image URL stops being validated and the SSRF hole reopens -- so the
    // absence is asserted against the source itself.
    const source = readFileSync(
      new URL("./ingest-image.ts", import.meta.url),
      "utf8"
    );
    // Deliberately not a match for `.get(` -- Map and Headers both use it, and
    // a check that cries wolf gets deleted. Network verbs and network imports
    // only.
    const network =
      /(?<![A-Za-z])(fetch|request|createConnection)\s*\(|(?<![A-Za-z.])(https?|net|dns)\.\w+\s*\(|from\s+["'](undici|node:http|node:https|node:net|node:dns|axios|got|node-fetch)["']/g;

    expect(source.match(network)).toBeNull();
    // ...and the check can see such a call when there is one. Each mutation is
    // a way a future edit could actually reach the network from here.
    expect(`${source}\nawait fetch(url);`.match(network)).toEqual(["fetch("]);
    expect(`${source}\nhttps.get(url, cb);`.match(network)).toEqual([
      "https.get(",
    ]);
    expect(
      `${source}\nimport { request } from "undici";`.match(network)
    ).toEqual(['from "undici"']);
    // The one import it does have.
    expect(source).toContain('import { safeFetch } from "./safe-fetch"');
  });
});

describe("ingestImage: what it uploads", () => {
  it.each(ACCEPTED)(
    "stores a %s under the sniffed type in the user's folder",
    async (_name, bytes, type) => {
      respondWith(bytes);
      const { client, uploads } = fakeSupabase();
      const path = await ingestImage("https://example.com/i", USER_ID, client);

      expect(uploads).toHaveLength(1);
      expect(uploads[0].bucket).toBe("wishlist-images");
      expect(uploads[0].body).toBe(bytes);
      expect(uploads[0].options).toMatchObject({
        contentType: type,
        cacheControl: "3600",
        upsert: false,
      });
      expect(path).toBe(uploads[0].path);
      expect(path!.split("/")[0]).toBe(USER_ID);
      expect(path!.endsWith(`.${ALLOWED.get(type)!}`)).toBe(true);
      expect(isOwnedStoragePath(path!, USER_ID)).toBe(true);
    }
  );

  it("uploads through the client it was given, and builds none of its own", () => {
    // The user-scoped client is what the folder-scoped INSERT policy applies
    // to. An admin client here would bypass RLS entirely, so the module must
    // not be able to reach one.
    const source = readFileSync(
      new URL("./ingest-image.ts", import.meta.url),
      "utf8"
    );
    expect(source).not.toMatch(/createAdminClient|createClient|SERVICE_ROLE/);
  });
});

describe("ingestImage: the declared type is never believed", () => {
  it("ignores a content-type that contradicts real image bytes", async () => {
    respondWith(PNG, "text/html; charset=utf-8");
    const { client, uploads } = fakeSupabase();
    const path = await ingestImage("https://example.com/i", USER_ID, client);
    expect(path).not.toBeNull();
    expect(uploads[0].options).toMatchObject({ contentType: "image/png" });
  });

  it("ignores a content-type that vouches for bytes that are not an image", async () => {
    respondWith(Buffer.from("<!DOCTYPE html><script>x</script>"), "image/png");
    const { client, uploads } = fakeSupabase();
    expect(await ingestImage("https://example.com/i", USER_ID, client)).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("accepts real bytes that arrived with no content-type at all", async () => {
    // null means "the response declared nothing", which is not a refusal.
    respondWith(JPEG, null);
    const { client } = fakeSupabase();
    expect(
      await ingestImage("https://example.com/i", USER_ID, client)
    ).not.toBeNull();
  });
});

describe("ingestImage: every failure is null, never a throw", () => {
  it("returns null when safeFetch refuses", async () => {
    // Again with a usable body attached, so ignoring `ok` shows up here.
    fetchControl.impl = () => ({ ok: false, reason: "too large", body: JPEG });
    const { client, uploads } = fakeSupabase();
    expect(
      await ingestImage("https://example.com/i", USER_ID, client)
    ).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("returns null when safeFetch throws", async () => {
    fetchControl.impl = () => {
      throw new Error("socket exploded");
    };
    const { client, uploads } = fakeSupabase();
    await expect(
      ingestImage("https://example.com/i", USER_ID, client)
    ).resolves.toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("returns null when the upload reports an error", async () => {
    respondWith(PNG);
    const { client, uploads } = fakeSupabase({
      error: { message: "new row violates row-level security policy" },
    });
    expect(
      await ingestImage("https://example.com/i", USER_ID, client)
    ).toBeNull();
    expect(uploads).toHaveLength(1);
  });

  it("returns null when the storage client throws", async () => {
    respondWith(PNG);
    const { client } = fakeSupabase(() => {
      throw new Error("fetch failed");
    });
    await expect(
      ingestImage("https://example.com/i", USER_ID, client)
    ).resolves.toBeNull();
  });

  it("returns null for a body that is empty", async () => {
    respondWith(Buffer.alloc(0), "image/png");
    const { client, uploads } = fakeSupabase();
    expect(
      await ingestImage("https://example.com/i", USER_ID, client)
    ).toBeNull();
    expect(uploads).toHaveLength(0);
  });

  it("refuses a body over the bucket's limit even if the fetcher hands one over", async () => {
    // safeFetch caps while streaming, so this cannot happen today. The check
    // exists so that a change there fails here rather than at the bucket.
    const huge = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]);
    respondWith(huge);
    const { client, uploads } = fakeSupabase();
    expect(
      await ingestImage("https://example.com/i", USER_ID, client)
    ).toBeNull();
    expect(uploads).toHaveLength(0);

    // One byte under, same bytes, and it goes.
    respondWith(
      Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES - PNG.length)])
    );
    const second = fakeSupabase();
    expect(
      await ingestImage("https://example.com/i", USER_ID, second.client)
    ).not.toBeNull();
    expect(second.uploads).toHaveLength(1);
  });

  it("uploads nothing when the path would fall outside the user's folder", async () => {
    respondWith(PNG);
    for (const bad of ["", "a/b", ".."]) {
      const { client, uploads } = fakeSupabase();
      expect(await ingestImage("https://example.com/i", bad, client)).toBeNull();
      expect(uploads).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------

/** A copy of `buf` with the bit flipped at `index`, for near-miss fixtures. */
function flip(buf: Buffer, index: number): Buffer {
  const out = Buffer.from(buf);
  out[index] ^= 0x01;
  return out;
}

/** A RIFF container whose form tag is `form`. */
function riff(form: string): Buffer {
  return Buffer.concat([
    Buffer.from("RIFF", "latin1"),
    Buffer.from([0x1a, 0x00, 0x00, 0x00]),
    Buffer.from(form, "latin1"),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
  ]);
}
