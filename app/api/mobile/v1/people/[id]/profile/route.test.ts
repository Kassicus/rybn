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

const { GET } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { MOM_ROW, momVisible, profileMocks } = await import("@/lib/mobile/test-profile");
const { IDS, SAM } = await import("@/lib/mobile/test-shopping");

const MOM = "user_2momABC";
const DAD = "user_2dadABC";
/** Nobody Sam's client can see has this id. */
const STRANGER = "user_2zzzZZZ";

const url = (id: string) => `http://localhost/api/mobile/v1/people/${encodeURIComponent(id)}/profile`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string = MOM) => GET(bearer(url(id)), ctx(id));

beforeEach(() => {
  holder.current = profileMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("GET /api/mobile/v1/people/[id]/profile", () => {
  it("answers 401 without a bearer, reading nothing", async () => {
    expect((await GET(new Request(url(MOM)), ctx(MOM))).status).toBe(401);
    expect(holder.current.personProfileRows).not.toHaveBeenCalled();
    expect(holder.current.getSharedGroups).not.toHaveBeenCalled();
  });

  it("answers the person-profile fixture", async () => {
    const res = await get();
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("person-profile"));
    expect(holder.current.personProfileRows.mock.calls).toEqual([[MOM]]);
    expect(holder.current.getSharedGroups.mock.calls).toEqual([[MOM]]);
  });

  it("never sends an email, a field's setting, a group's description, or anything about what was hidden", async () => {
    holder.current.personProfileRows.mockResolvedValue({
      row: { ...MOM_ROW, email: "mom@example.com" },
      info: momVisible().map((r) => ({ ...r, privacy_settings: { visibleToGroupTypes: ["family"], restrictToGroup: null } })),
    });
    holder.current.getSharedGroups.mockResolvedValue({
      data: [{ id: "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e", name: "Rivera Family", type: "family", description: "Everyone on Mom's side." }],
    });
    const res = await get();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual(fixture("person-profile"));
    expect(text).not.toMatch(/email|@example\.com|privacy|visibleToGroupTypes|Everyone on Mom|hidden|Paddington/);
  });

  it("answers 404 for a person the caller shares no group with", async () => {
    // Nobody the caller's client can see by that id.
    const unseen = await get(STRANGER);
    expect([unseen.status, (await unseen.json()).error]).toEqual([404, { code: "not_found", message: "That isn't there any more." }]);
    expect(holder.current.getSharedGroups).not.toHaveBeenCalled();

    // Someone whose columns can be read, with no group in common.
    holder.current.getSharedGroups.mockResolvedValue({ data: [] });
    const apart = await get();
    expect([apart.status, (await apart.json()).error]).toEqual([404, { code: "not_found", message: "That isn't there any more." }]);
  });

  it("answers a group-mate who lets the caller see none of their fields with no sections, never 404", async () => {
    // Dad shares Rivera Family with Sam and has nothing Sam may see.
    const res = await get(DAD);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      person: { id: DAD, name: "Dad", username: "luis", avatarUrl: null },
      bio: null,
      sections: [],
      sharedGroups: [{ id: IDS.rivera, name: "Rivera Family" }],
    });
  });

  it("leaves a shared group stored with no name out of the list, deciding the 404 before that", async () => {
    holder.current.getSharedGroups.mockResolvedValue({
      data: [{ id: IDS.rivera, name: "Rivera Family", type: "family" }, { id: IDS.bookClub, name: "", type: "friends" }],
    });
    expect((await (await get()).json()).sharedGroups).toEqual([{ id: IDS.rivera, name: "Rivera Family" }]);

    // Sharing only a group with no name is still sharing a group.
    holder.current.getSharedGroups.mockResolvedValue({ data: [{ id: IDS.bookClub, name: "", type: "friends" }] });
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).sharedGroups).toEqual([]);
  });

  it("answers 404 for the caller's own id, asking nothing", async () => {
    // Their own profile is GET /profile, with every field and who sees it.
    const res = await get(SAM);
    expect([res.status, (await res.json()).error]).toEqual([404, { code: "not_found", message: "That isn't there any more." }]);
    expect(holder.current.personProfileRows).not.toHaveBeenCalled();
    expect(holder.current.getSharedGroups).not.toHaveBeenCalled();
  });

  it("answers 404 for an id that cannot be a person, asking nothing", async () => {
    for (const id of ["a/b", "", "user 2momABC", "x".repeat(129)]) expect((await get(id)).status).toBe(404);
    expect(holder.current.personProfileRows).not.toHaveBeenCalled();
    expect(holder.current.getSharedGroups).not.toHaveBeenCalled();
  });

  it("answers 401 when nobody is signed in, and 500 for a database error", async () => {
    holder.current.getSharedGroups.mockResolvedValue({ error: "Not authenticated" });
    expect((await get()).status).toBe(401);

    holder.current.getSharedGroups.mockResolvedValue({ error: "function get_shared_groups does not exist" });
    const res = await get();
    expect([res.status, (await res.json()).error]).toEqual([500, { code: "server_error", message: "Something went wrong. Please try again." }]);

    holder.current.personProfileRows.mockRejectedValue(new Error("personProfileRows failed: boom"));
    const failed = await get();
    expect(failed.status).toBe(500);
    expect(await failed.text()).not.toMatch(/boom/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/api/mobile/v1/people/"), expect.anything());
  });
});
