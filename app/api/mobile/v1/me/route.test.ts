import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const ensureProfile = vi.fn();
const loadMe = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/mobile/me-live", () => ({ loadMe: (id: string) => loadMe(id) }));

const { GET } = await import("./route");

const meFixture = JSON.parse(readFileSync("lib/mobile/fixtures/me.json", "utf8"));
const errorFixture = JSON.parse(readFileSync("lib/mobile/fixtures/error.json", "utf8"));

const request = (headers: Record<string, string> = { authorization: "Bearer test-token" }) =>
  new Request("http://localhost/api/mobile/v1/me", { headers });
const ctx = { params: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/mobile/v1/me", () => {
  it("answers 401 in the envelope when nobody is signed in", async () => {
    ensureProfile.mockResolvedValue(null);
    const res = await GET(request(), ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(errorFixture);
    expect(loadMe).not.toHaveBeenCalled();
  });

  it("answers the profile for the signed-in person", async () => {
    ensureProfile.mockResolvedValue("user_2abcDEF");
    loadMe.mockResolvedValue(meFixture);
    const res = await GET(request(), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(meFixture);
    expect(loadMe).toHaveBeenCalledWith("user_2abcDEF");
  });

  it("answers 500 when the profile row is missing", async () => {
    ensureProfile.mockResolvedValue("user_2abcDEF");
    loadMe.mockRejectedValue(new Error("no profile row"));
    const res = await GET(request(), ctx);
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_error");
  });

  it("answers 401 without identifying anyone when only a session cookie is sent", async () => {
    ensureProfile.mockResolvedValue("user_2abcDEF");
    const res = await GET(request({ cookie: "__session=abc" }), ctx);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(errorFixture);
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("answers 426 when MOBILE_MIN_BUILD is set and the build is too old", async () => {
    vi.stubEnv("MOBILE_MIN_BUILD", "5");
    const res = await GET(request({ authorization: "Bearer test-token", "x-app-build": "4" }), ctx);
    expect(res.status).toBe(426);
    expect((await res.json()).error.code).toBe("upgrade_required");
    expect(ensureProfile).not.toHaveBeenCalled();
  });
});
