import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { ProfileMocks } from "@/lib/mobile/test-profile";

const holder = vi.hoisted(() => ({ current: undefined as unknown as ProfileMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/profile", () => ({
  getMyProfile: (...a: unknown[]) => holder.current.getMyProfile(...a),
  updateProfile: (...a: unknown[]) => holder.current.updateProfile(...a),
  getSharedGroups: (...a: unknown[]) => holder.current.getSharedGroups(...a),
}));
vi.mock("@/lib/actions/settings", () => ({
  getMySettings: (...a: unknown[]) => holder.current.getMySettings(...a),
  updatePrivacySettings: (...a: unknown[]) => holder.current.updatePrivacySettings(...a),
}));
vi.mock("@/lib/mobile/profile-reads", () => ({
  personProfileRows: (...a: unknown[]) => holder.current.personProfileRows(...a),
}));

const { GET, PUT } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { SAM_CHOICE, profileMocks } = await import("@/lib/mobile/test-profile");

const url = "http://localhost/api/mobile/v1/profile";
const ctx = { params: Promise.resolve({}) };
const get = () => bearer(url);
const put = (body: unknown) =>
  bearer(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

type Field = { name: string; value: string | null };
type Profile = { sections: { fields: Field[] }[]; visibleTo: string[]; mixed: boolean };
const fieldsOf = (profile: Profile) => profile.sections.flatMap((s) => s.fields);
/** The profile fixture with these fields' values changed. */
const profileWith = (changes: Record<string, string | null>) => {
  const { profile } = fixture("profile");
  for (const field of fieldsOf(profile)) if (field.name in changes) field.value = changes[field.name];
  return { profile };
};

beforeEach(() => {
  holder.current = profileMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/profile", () => {
  it("answers 401 without a bearer, reading nothing", async () => {
    expect((await GET(new Request(url), ctx)).status).toBe(401);
    expect(holder.current.getMyProfile).not.toHaveBeenCalled();
    expect(holder.current.getMySettings).not.toHaveBeenCalled();
  });

  it("answers the profile fixture, never cached", async () => {
    const res = await GET(get(), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("profile"));
  });

  it("never sends the email, the email preferences or anything else of the rows", async () =>
    expect(await (await GET(get(), ctx)).text())
      .not.toMatch(/email|@example\.com|created_at|user_id|privacy_settings|visibleToGroupTypes|restrictToGroup|0a0b0c0d/));

  it("answers the stored choice for a person with no fields", async () => {   // Review Focus 4
    const mine = await holder.current.getMyProfile();
    holder.current.getMyProfile.mockResolvedValue({ data: { ...mine.data, profile_info: [] } });
    const { profile } = await (await GET(get(), ctx)).json();
    expect(fieldsOf(profile).map((f) => f.value)).toEqual(Array(23).fill(null));
    expect([profile.visibleTo, profile.mixed]).toEqual([[...SAM_CHOICE], false]);
  });

  it("says mixed when one of the fields has another setting", async () => {
    const mine = await holder.current.getMyProfile();
    const [first, ...rest] = mine.data.profile_info;
    holder.current.getMyProfile.mockResolvedValue({
      data: { ...mine.data, profile_info: [{ ...first, privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null } }, ...rest] },
    });
    expect((await (await GET(get(), ctx)).json()).profile.mixed).toBe(true);
  });

  it("answers 401 when nobody is signed in, and 500 for a database error", async () => {
    holder.current.getMyProfile.mockResolvedValue({ error: "Not authenticated" });
    expect((await GET(get(), ctx)).status).toBe(401);

    holder.current.getMyProfile.mockResolvedValue({ error: 'relation "user_profiles" does not exist' });
    const res = await GET(get(), ctx);
    expect([res.status, (await res.json()).error]).toEqual([500, { code: "server_error", message: "Something went wrong. Please try again." }]);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/profile"), expect.anything());

    holder.current = profileMocks();
    holder.current.getMySettings.mockResolvedValue({ data: null, error: "Failed to load settings" });
    expect((await GET(get(), ctx)).status).toBe(500);
  });
});

describe("PUT /api/mobile/v1/profile", () => {
  it("answers 401 without a bearer, writing nothing", async () => {
    const res = await PUT(new Request(url, { method: "PUT", body: JSON.stringify(fixture("profile-request")) }), ctx);
    expect(res.status).toBe(401);
    expect(holder.current.updateProfile).not.toHaveBeenCalled();
  });

  it("passes on only the fields the body names", async () => {   // Review Focus 3
    const res = await PUT(put(fixture("profile-request")), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(holder.current.updateProfile).toHaveBeenCalledTimes(1);
    const [input] = holder.current.updateProfile.mock.calls[0];
    // No avatar, so the action leaves it as it is, and no visible_to_group_types, so a save never names who can see.
    expect(Object.keys(input)).toEqual(["username", "display_name", "bio", "shirt_size", "hobbies"]);
    expect(input).toEqual({
      username: "sam",
      display_name: "Sam Rivera",
      bio: "Coffee, maps and long walks.",
      shirt_size: "L",
      hobbies: null,
    });
    // The answer is the profile, read again after the save: every other field as it was, who sees it unchanged.
    expect(await res.json()).toEqual(profileWith({ shirt_size: "L", hobbies: null }));
    expect(holder.current.getMyProfile.mock.invocationCallOrder[0])
      .toBeGreaterThan(holder.current.updateProfile.mock.invocationCallOrder[0]);
  });

  it("passes on what the person typed trimmed, and an emptied field as a clear", async () => {
    const res = await PUT(put({ username: " sam ", displayName: " Sam Rivera ", bio: "", fields: { shirt_size: " L ", shoe_size: " " } }), ctx);
    expect(res.status).toBe(200);
    expect(holder.current.updateProfile.mock.calls[0][0])
      .toEqual({ username: "sam", display_name: "Sam Rivera", bio: null, shirt_size: "L", shoe_size: null });
    const { profile } = await res.json();
    expect([profile.bio, fieldsOf(profile).find((f) => f.name === "shoe_size")?.value]).toEqual([null, null]);
  });

  it("never passes on the row the action answers", async () => {
    const text = await (await PUT(put(fixture("profile-request")), ctx)).text();
    expect(text).not.toMatch(/email|@example\.com|created_at|user_2abcDEF/);
  });

  it("answers a taken username as 422", async () => {
    holder.current.updateProfile.mockResolvedValue({ error: "Username is already taken" });
    const res = await PUT(put(fixture("profile-request")), ctx);
    expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "Username is already taken" }]);
    expect(holder.current.getMyProfile).not.toHaveBeenCalled();
  });

  it("refuses what the form's schema refuses before writing anything", async () => {
    const request = fixture("profile-request");
    for (const [body, message] of [
      [{ ...request, fields: { shirt_size: "x".repeat(21) } }, "Shirt size must be at most 20 characters"],
      [{ ...request, username: "ab" }, "Username must be at least 3 characters"],
      [{ ...request, username: "sam rivera" }, "Username can only contain letters, numbers, underscores, and hyphens"],
      [{ ...request, bio: "x".repeat(501) }, "Bio must be less than 500 characters"],
      [{ ...request, fields: { birthday: "1991-02-30" } }, "Please enter a valid date (YYYY-MM-DD)"],
    ] as const) {
      const res = await PUT(put(body), ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
    }
    expect(holder.current.updateProfile).not.toHaveBeenCalled();
  });

  it("refuses a character Rybn cannot save with the sentence, writing nothing", async () => {
    const request = fixture("profile-request");
    for (const body of [
      { ...request, displayName: "Sam\u0000Rivera" },
      { ...request, bio: "Coffee\u0000" },
      { ...request, fields: { shirt_size: "M\u0000L" } },
      { ...request, fields: { hobbies: "Hiking\u0007" } },
      { ...request, fields: { favorite_colors: "Green\nnavy" } },
    ]) {
      const res = await PUT(put(body), ctx);
      expect([res.status, (await res.json()).error], JSON.stringify(body))
        .toEqual([422, { code: "invalid", message: "That has characters Rybn can't save. Try typing it again." }]);
    }
    expect(holder.current.updateProfile).not.toHaveBeenCalled();
  });

  it("saves a bio and a longer field over several lines", async () => {
    const res = await PUT(put({ ...fixture("profile-request"), bio: "Coffee,\nmaps and\tlong walks.", fields: { hobbies: "Hiking\r\nboard games" } }), ctx);
    expect(res.status).toBe(200);
    expect(holder.current.updateProfile.mock.calls[0][0])
      .toMatchObject({ bio: "Coffee,\nmaps and\tlong walks.", hobbies: "Hiking\r\nboard games" });
  });

  it("counts a field's limit after trimming", async () => {
    const res = await PUT(put({ ...fixture("profile-request"), fields: { shirt_size: ` ${"x".repeat(20)} ` } }), ctx);
    expect(res.status).toBe(200);
    expect(holder.current.updateProfile.mock.calls[0][0].shirt_size).toBe("x".repeat(20));
  });

  it("refuses a body that is not a profile, writing nothing", async () => {
    for (const body of [[], { username: "sam" }, { ...fixture("profile-request"), fields: { email: "sam@example.com" } }]) {
      const res = await PUT(put(body), ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message: "That request wasn't valid." }]);
    }
    expect((await PUT(bearer(url, { method: "PUT" }), ctx)).status).toBe(422);
    expect(holder.current.updateProfile).not.toHaveBeenCalled();
  });

  it("answers 401 when nobody is signed in, and 500 for a database error", async () => {
    holder.current.updateProfile.mockResolvedValue({ error: "Not authenticated" });
    expect((await PUT(put(fixture("profile-request")), ctx)).status).toBe(401);

    holder.current.updateProfile.mockResolvedValue({ error: 'duplicate key value violates unique constraint "profile_info_pkey"' });
    const res = await PUT(put(fixture("profile-request")), ctx);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toMatch(/duplicate|profile_info/);

    // Saved, then the profile cannot be read back.
    holder.current = profileMocks();
    holder.current.getMyProfile.mockResolvedValue({ error: "connection reset" });
    expect((await PUT(put(fixture("profile-request")), ctx)).status).toBe(500);
    expect(holder.current.updateProfile).toHaveBeenCalledTimes(1);
  });
});
