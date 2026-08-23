import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What is real here and what is not.
 *
 * The action's own job is WIRING: which client goes to which collaborator, and
 * which URL is used as the base for what the page says about itself. So the
 * collaborators are mocked at their module boundaries -- each is tested for
 * real in its own file -- and the parser is left alone, because "the extracted
 * image URL is resolved against the right base" is a fact about the pair and
 * cannot be observed with the parser stubbed out.
 *
 * `safeFetch` is mocked rather than driven, so nothing here proves `finalUrl`
 * is reported correctly; `safe-fetch.test.ts` proves that against a loopback
 * redirect. What this file proves is that the action USES it.
 */

const control = vi.hoisted(() => ({
  fetchResult: null as unknown,
  /** Every URL handed to `ingestImage`, in order. */
  ingested: [] as string[],
  /** Every value handed to the signer, and the viewer it was signed for. */
  signed: [] as Array<{ path: string | null | undefined; viewer: string }>,
  /** What `ingestImage` hands back. `null` is a failed ingest. */
  ingestResult: "user_2abcDEF456ghiJKL/1700000000000-abc.jpg" as string | null,
  /** What the signer hands back for that path. */
  signResult: "https://storage.test/sign/abc?token=xyz" as string | null,
}));

const USER_ID = "user_2abcDEF456ghiJKL";

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: async () => USER_ID,
}));

// The rate-limit ledger: a read that reports an empty window and a write that
// succeeds. Both are exercised for what they are elsewhere; here they only need
// to let the request through.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => Promise.resolve({ count: 0, error: null }),
      insert: () => Promise.resolve({ error: null }),
    };
    return { from: () => chain };
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ __userScoped: true }),
}));

vi.mock("@/lib/link-metadata/safe-fetch", () => ({
  safeFetch: async () => control.fetchResult,
}));

vi.mock("@/lib/link-metadata/ingest-image", () => ({
  ingestImage: async (imageUrl: string) => {
    control.ingested.push(imageUrl);
    return control.ingestResult;
  },
}));

// `lib/supabase/signed-image.ts` imports "server-only", which does not resolve
// outside a Next build, so this boundary has to be mocked whatever else the
// test wants. It records what it was asked to sign.
vi.mock("@/lib/supabase/signed-image", () => ({
  withSignedWishlistImage: async (
    item: { image_url?: string | null; user_id?: string | null },
    viewerId: string
  ) => {
    control.signed.push({ path: item.image_url, viewer: viewerId });
    return { ...item, image_url: control.signResult, image_path: item.image_url ?? null };
  },
}));

const { fetchLinkMetadata } = await import("./link-metadata");

/** A product page that names its image with a RELATIVE reference. */
const PAGE = [
  "<html><head>",
  '<meta property="og:title" content="Cast Iron Skillet">',
  '<meta property="og:image" content="hero.jpg">',
  "</head><body></body></html>",
].join("");

function served(finalUrl: string, html = PAGE) {
  control.fetchResult = {
    ok: true,
    body: Buffer.from(html, "utf8"),
    contentType: "text/html",
    finalUrl,
  };
}

beforeEach(() => {
  control.fetchResult = null;
  control.ingested = [];
  control.signed = [];
  control.ingestResult = `${USER_ID}/1700000000000-abc.jpg`;
  control.signResult = "https://storage.test/sign/abc?token=xyz";
});

// ---------------------------------------------------------------------------
describe("the extraction base is the URL the page was SERVED from", () => {
  it("resolves a relative og:image against the final URL, not the pasted one", async () => {
    // The ordinary shape of a product link: a shortener, or a geo/utm redirect,
    // landing on a real page several segments deep on another host.
    served("https://shop.example/store/p/skillet");

    const result = await fetchLinkMetadata("https://lnk.example/abc");

    expect(control.ingested).toEqual([
      "https://shop.example/store/p/hero.jpg",
    ]);
    // Spelled out, because this exact string is what the bug produced: the
    // right filename on the wrong host, fetched, 404'd, and dropped in silence.
    expect(control.ingested[0]).not.toBe("https://lnk.example/hero.jpg");
    // The rest of the lookup is unaffected either way, which is why nothing
    // else in the suite noticed.
    expect(result.title).toBe("Cast Iron Skillet");
  });

  it("resolves against the requested URL when nothing redirected", async () => {
    served("https://shop.example/store/p/skillet");
    await fetchLinkMetadata("https://shop.example/store/p/skillet");
    expect(control.ingested).toEqual([
      "https://shop.example/store/p/hero.jpg",
    ]);
  });

  it("leaves an absolute og:image alone, wherever the page came from", async () => {
    served(
      "https://shop.example/store/p/skillet",
      '<html><head><meta property="og:image" content="https://cdn.example/i/9.jpg"></head></html>'
    );
    await fetchLinkMetadata("https://lnk.example/abc");
    expect(control.ingested).toEqual(["https://cdn.example/i/9.jpg"]);
  });
});

// ---------------------------------------------------------------------------
describe("the ingested image comes back renderable as well as storable", () => {
  it("returns the stored path and a signed URL for it", async () => {
    served("https://shop.example/store/p/skillet");
    const result = await fetchLinkMetadata("https://lnk.example/abc");

    expect(result.imagePath).toBe(`${USER_ID}/1700000000000-abc.jpg`);
    expect(result.imagePreviewUrl).toBe("https://storage.test/sign/abc?token=xyz");
    // Signed for the path that was just written, on behalf of the user who
    // wrote it -- the helper masks a path whose owner is not the viewer.
    expect(control.signed).toEqual([
      { path: `${USER_ID}/1700000000000-abc.jpg`, viewer: USER_ID },
    ]);
  });

  it("signs nothing when the ingest produced nothing", async () => {
    control.ingestResult = null;
    served("https://shop.example/store/p/skillet");
    const result = await fetchLinkMetadata("https://lnk.example/abc");

    expect(result.imagePath).toBeUndefined();
    expect(result.imagePreviewUrl).toBeUndefined();
    expect(control.signed).toEqual([]);
    // And the text survives, which is the whole point of the image being
    // best-effort.
    expect(result.title).toBe("Cast Iron Skillet");
  });

  it("keeps the path when the URL cannot be signed", async () => {
    // A preview is a convenience; the path is the thing that gets saved. Losing
    // the signature must not lose the image.
    control.signResult = null;
    served("https://shop.example/store/p/skillet");
    const result = await fetchLinkMetadata("https://lnk.example/abc");

    expect(result.imagePath).toBe(`${USER_ID}/1700000000000-abc.jpg`);
    expect(result.imagePreviewUrl).toBeUndefined();
  });

  it("never signs anything when the page advertised no image", async () => {
    served(
      "https://shop.example/store/p/skillet",
      '<html><head><meta property="og:title" content="No Picture"></head></html>'
    );
    const result = await fetchLinkMetadata("https://lnk.example/abc");

    expect(control.ingested).toEqual([]);
    expect(control.signed).toEqual([]);
    expect(result.title).toBe("No Picture");
    expect(result.imagePreviewUrl).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
describe("a refusal is a sentence, and never raw error text", () => {
  it("passes safeFetch's own reason straight through", async () => {
    control.fetchResult = {
      ok: false,
      reason: "That link points somewhere we will not fetch from.",
    };
    const result = await fetchLinkMetadata("http://169.254.169.254/");

    expect(result.error).toBe("That link points somewhere we will not fetch from.");
    expect(control.ingested).toEqual([]);
  });

  it("refuses a body that never claimed to be HTML", async () => {
    control.fetchResult = {
      ok: true,
      body: Buffer.from(PAGE, "utf8"),
      contentType: null,
      finalUrl: "https://shop.example/store/p/skillet",
    };
    const result = await fetchLinkMetadata("https://shop.example/store/p/skillet");

    expect(result.error).toBe("That link is not a web page we can read.");
    expect(result.title).toBeUndefined();
  });
});
