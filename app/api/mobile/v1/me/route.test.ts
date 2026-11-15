import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const ensureProfile = vi.fn();
const loadMe = vi.fn();
const getUserId = vi.fn();
const deleteAccount = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: () => ensureProfile() }));
vi.mock("@/lib/mobile/me-live", () => ({ loadMe: (id: string) => loadMe(id) }));
// The real module imports "server-only", which throws outside a server build.
vi.mock("@/lib/auth/require-auth", () => ({ getUserId: () => getUserId() }));
vi.mock("@/lib/actions/account", () => ({ deleteAccount: () => deleteAccount() }));

const { GET, DELETE } = await import("./route");

const meFixture = JSON.parse(readFileSync("lib/mobile/fixtures/me.json", "utf8"));
const errorFixture = JSON.parse(readFileSync("lib/mobile/fixtures/error.json", "utf8"));

const request = (headers: Record<string, string> = { authorization: "Bearer test-token" }) =>
  new Request("http://localhost/api/mobile/v1/me", { headers });
const deleteRequest = (headers: Record<string, string> = { authorization: "Bearer test-token" }) =>
  new Request("http://localhost/api/mobile/v1/me", { method: "DELETE", headers });
const ctx = { params: Promise.resolve({}) };

const DELETE_FAILED = "Couldn't delete your account. Please try again.";

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

describe("DELETE /api/mobile/v1/me", () => {
  it("deletes the account and answers 204, making no profile", async () => {
    getUserId.mockResolvedValue("user_2abcDEF");
    deleteAccount.mockResolvedValue({ success: true });
    const res = await DELETE(deleteRequest(), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(await res.text()).toBe("");
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("answers a second DELETE after one that failed half way with 204, making no profile", async () => {
    getUserId.mockResolvedValue("user_2abcDEF");
    deleteAccount.mockResolvedValueOnce({ error: DELETE_FAILED }).mockResolvedValueOnce({ success: true });
    expect((await DELETE(deleteRequest(), ctx)).status).toBe(500);
    expect((await DELETE(deleteRequest(), ctx)).status).toBe(204);
    expect(deleteAccount).toHaveBeenCalledTimes(2);
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("answers 401 without a bearer, and when the token names nobody, deleting nothing", async () => {
    getUserId.mockResolvedValue("user_2abcDEF");
    const cookieOnly = await DELETE(deleteRequest({ cookie: "__session=abc" }), ctx);
    expect([cookieOnly.status, await cookieOnly.json()]).toEqual([401, errorFixture]);
    expect(getUserId).not.toHaveBeenCalled();

    getUserId.mockResolvedValue(null);
    const nobody = await DELETE(deleteRequest(), ctx);
    expect([nobody.status, await nobody.json()]).toEqual([401, errorFixture]);
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(ensureProfile).not.toHaveBeenCalled();
  });

  it("answers 401 when the action finds nobody signed in", async () => {
    getUserId.mockResolvedValue("user_2abcDEF");
    deleteAccount.mockResolvedValue({ error: "Not authenticated" });
    const res = await DELETE(deleteRequest(), ctx);
    expect([res.status, await res.json()]).toEqual([401, errorFixture]);
  });

  it("answers 500 without the action's words when it fails", async () => {
    getUserId.mockResolvedValue("user_2abcDEF");
    deleteAccount.mockResolvedValue({ error: DELETE_FAILED });
    const res = await DELETE(deleteRequest(), ctx);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("server_error");
    expect(text).not.toMatch(/Couldn't delete/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/me"), expect.anything());
  });
});
