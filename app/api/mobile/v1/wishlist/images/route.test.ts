import { describe, it, expect, vi, beforeEach } from "vitest";
import { isOwnedStoragePath } from "@/lib/storage/image-value";
import { fixture } from "@/lib/mobile/test-fixtures";
import { PICTURE_MAX_BYTES, PICTURE_RULES } from "@/lib/mobile/picture";

const ensureProfile = vi.fn();
const uploadSpy = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ storage: { from: (bucket: string) => ({ upload: uploadSpy.bind(null, bucket) }) } }),
}));
const signImage = vi.fn();
vi.mock("@/lib/supabase/signed-image", () => ({
  withSignedWishlistImage: (i: { image_url: string }, userId: string) => signImage(i, userId),
}));

const { POST } = await import("./route");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const url = "http://localhost/api/mobile/v1/wishlist/images";
const upload = (type: string, bytes: Uint8Array) =>
  new Request(url, { method: "POST", headers: { authorization: "Bearer t", "content-type": type }, body: bytes as BodyInit });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  ensureProfile.mockResolvedValue("user_2abcDEF");
  signImage.mockImplementation(async (i: { image_url: string }) => ({ ...i, image_url: "https://signed.example/x", image_path: i.image_url }));
});

describe("POST /api/mobile/v1/wishlist/images", () => {
  it("stores a JPEG in the caller's own folder and answers its path and address", async () => {
    uploadSpy.mockResolvedValue({ data: {}, error: null });
    const res = await POST(upload("image/jpeg", JPEG), ctx);
    expect(res.status).toBe(200);
    const [bucket, path, , options] = uploadSpy.mock.calls[0];
    expect(bucket).toBe("wishlist-images");
    expect(path).toMatch(/^user_2abcDEF\/\d{13}-[0-9a-f-]{36}\.jpg$/);
    expect(isOwnedStoragePath(path, "user_2abcDEF")).toBe(true);
    expect(options).toMatchObject({ contentType: "image/jpeg", upsert: false });
    expect(await res.json()).toEqual({ imagePath: path, imageUrl: "https://signed.example/x" });
  });
  it("answers exactly the keys of the picture fixture, both strings", async () => {
    uploadSpy.mockResolvedValue({ data: {}, error: null });
    const body = await (await POST(upload("image/jpeg", JPEG), ctx)).json();
    const expected = fixture("picture");
    expect(Object.keys(body).sort()).toEqual(Object.keys(expected).sort());
    for (const key of Object.keys(expected)) {
      expect(typeof expected[key]).toBe("string");
      expect(typeof body[key]).toBe("string");
    }
  });
  it("answers 500 when signing returns no address, naming nothing of storage", async () => {
    uploadSpy.mockResolvedValue({ data: {}, error: null });
    signImage.mockImplementation(async (i: { image_url: string }) => ({ ...i, image_url: null }));
    const res = await POST(upload("image/jpeg", JPEG), ctx);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toMatch(/sign|storage|wishlist-images|user_2abcDEF/i);
  });
  it("stores a PNG as .png", async () => {
    uploadSpy.mockResolvedValue({ data: {}, error: null });
    const res = await POST(upload("image/png", PNG), ctx);
    expect(res.status).toBe(200);
    const [, path, , options] = uploadSpy.mock.calls[0];
    expect(path).toMatch(/\.png$/);
    expect(options).toMatchObject({ contentType: "image/png" });
  });
  it("answers 422 for another type, a body over 4 MB, or bytes that don't match, and stores nothing", async () => {
    const big = new Uint8Array(PICTURE_MAX_BYTES + 1);
    big.set(JPEG);
    const cases: [Request, string][] = [
      [upload("image/gif", JPEG), PICTURE_RULES.type],
      [upload("image/jpeg", big), PICTURE_RULES.size],
      [upload("image/png", JPEG), PICTURE_RULES.bytes],
    ];
    for (const [request, message] of cases) {
      const res = await POST(request, ctx);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toEqual({ code: "invalid", message });
    }
    expect(uploadSpy).not.toHaveBeenCalled();
  });
  it("answers 500 when storage refuses, without passing on its words", async () => {
    uploadSpy.mockResolvedValue({ data: null, error: { message: "new row violates row-level security policy" } });
    const res = await POST(upload("image/jpeg", JPEG), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/row-level/);
  });
  it("answers 401 without a bearer token and stores nothing", async () => {
    const res = await POST(new Request(url, { method: "POST", headers: { "content-type": "image/jpeg" }, body: JPEG as BodyInit }), ctx);
    expect(res.status).toBe(401);
    expect(uploadSpy).not.toHaveBeenCalled();
  });
});
