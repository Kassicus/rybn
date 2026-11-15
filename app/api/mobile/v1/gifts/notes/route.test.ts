import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import type { WorldMocks } from "@/lib/mobile/test-shopping-mocks";

const holder = vi.hoisted(() => ({ current: undefined as unknown as WorldMocks }));
const updateRecipient = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/occasions", () => ({ getUpcomingOccasions: (...a: unknown[]) => holder.current.getUpcomingOccasions(...a) }));
vi.mock("@/lib/actions/groups", () => ({
  getMyGroups: (...a: unknown[]) => holder.current.getMyGroups(...a),
  getGroupById: (...a: unknown[]) => holder.current.getGroupById(...a),
}));
vi.mock("@/lib/actions/wishlist", () => ({
  getUserWishlist: (...a: unknown[]) => holder.current.getUserWishlist(...a),
  getWishlistItem: (...a: unknown[]) => holder.current.getWishlistItem(...a),
  markAsPurchased: (...a: unknown[]) => holder.current.markAsPurchased(...a),
}));
vi.mock("@/lib/actions/claims", () => ({
  getActiveClaims: (...a: unknown[]) => holder.current.getActiveClaims(...a),
  releaseClaim: (...a: unknown[]) => holder.current.releaseClaim(...a),
}));
vi.mock("@/lib/actions/item-occasions", () => ({ getTagsForItems: (...a: unknown[]) => holder.current.getTagsForItems(...a) }));
vi.mock("@/lib/actions/profile", () => ({ getSharedGroups: (...a: unknown[]) => holder.current.getSharedGroups(...a) }));
vi.mock("@/lib/actions/gift-tracking", () => ({ updateRecipient: (...a: unknown[]) => updateRecipient(...a) }));
vi.mock("@/lib/mobile/people-live", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mobile/people-live")>()),
  profiles: (...a: unknown[]) => holder.current.profiles(...a),
  groupMembers: (...a: unknown[]) => holder.current.groupMembers(...a),
  memberCounts: (...a: unknown[]) => holder.current.memberCounts(...a),
  visibleItemCounts: (...a: unknown[]) => holder.current.visibleItemCounts(...a),
  occasionRows: (...a: unknown[]) => holder.current.occasionRows(...a),
  linkedItems: (...a: unknown[]) => holder.current.linkedItems(...a),
}));
vi.mock("@/lib/mobile/gift-store-live", () => ({ createGiftStore: async () => holder.current.store }));
vi.mock("@/lib/supabase/signed-image", () => ({
  withSignedGiftPhotos: (...a: unknown[]) => holder.current.withSignedGiftPhotos(...a),
  withSignedGiftPhoto: (...a: unknown[]) => holder.current.withSignedGiftPhoto(...a),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: holder.current.rpc }) }));
vi.mock("@/lib/claims/active", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/claims/active")>()),
  todayISO: () => holder.current.todayISO(),
}));

const { PUT } = await import("./route");
const { bearer, worldMocks } = await import("@/lib/mobile/test-shopping-mocks");
const { memoryGiftStore } = await import("@/lib/mobile/test-gift-store");
const { IDS, SAM, world } = await import("@/lib/mobile/test-shopping");

const ctx = { params: Promise.resolve({}) };
const put = (body: unknown) =>
  bearer("http://localhost/api/mobile/v1/gifts/notes", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const request = () => fixture("gift-notes-request");
const JOE = "recipient:" + IDS.recipientJoe;

beforeEach(() => {
  holder.current = worldMocks();
  updateRecipient.mockReset();
  updateRecipient.mockResolvedValue({ data: {} });
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PUT /api/mobile/v1/gifts/notes", () => {
  it("saves the request fixture's name and notes on the caller's typed row and answers 204", async () => {
    const res = await PUT(put(request()), ctx);
    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(await res.text()).toBe("");
    expect(updateRecipient.mock.calls).toEqual([[IDS.recipientJoe, { name: "Grandpa Joe", notes: "Fishes most Sundays. Size L hats." }]]);
  });

  it("clears a typed row's notes with an empty string", async () => {
    expect((await PUT(put({ ...request(), notes: "" }), ctx)).status).toBe(204);
    expect(updateRecipient.mock.calls).toEqual([[IDS.recipientJoe, { name: "Grandpa Joe", notes: "" }]]);
  });

  it("saves a note on the row tied to a person, never its name", async () => {
    expect((await PUT(put({ key: "person:user_2momABC", notes: "Medium" }), ctx)).status).toBe(204);
    // Strict: a `name` key, even one holding undefined, fails it.
    expect(updateRecipient.mock.calls).toStrictEqual([[IDS.recipientMom, { notes: "Medium" }]]);
    expect(holder.current.store.writes).toEqual([]);
  });

  it("keeps saving on a person's row after they have left the caller's groups", async () => {
    holder.current.getSharedGroups.mockResolvedValue({ data: [] });
    expect((await PUT(put({ key: "person:user_2momABC", notes: "Medium" }), ctx)).status).toBe(204);
    expect(updateRecipient.mock.calls).toEqual([[IDS.recipientMom, { notes: "Medium" }]]);
    expect(holder.current.getSharedGroups).not.toHaveBeenCalled();
  });

  it("makes the row for a group-mate who has none, named as the gifts code names it", async () => {
    expect((await PUT(put({ key: "person:user_2dadABC", notes: "Size 10 shoes" }), ctx)).status).toBe(204);
    const made = holder.current.store.allRecipients().filter((r) => r.person_id === "user_2dadABC");
    expect(made).toEqual([expect.objectContaining({ name: "Dad", person_id: "user_2dadABC" })]);
    expect(updateRecipient.mock.calls).toEqual([[made[0].id, { notes: "Size 10 shoes" }]]);
    expect(holder.current.getSharedGroups.mock.calls).toEqual([["user_2dadABC"]]);
  });

  it("names it Dad (from their list) when a typed row already has the name", async () => {
    await holder.current.store.insertRecipient({ name: "Dad", person_id: null });
    expect((await PUT(put({ key: "person:user_2dadABC", notes: "Size 10 shoes" }), ctx)).status).toBe(204);
    const made = holder.current.store.allRecipients().filter((r) => r.person_id === "user_2dadABC");
    expect(made).toEqual([expect.objectContaining({ name: "Dad (from their list)" })]);
    expect(updateRecipient.mock.calls).toEqual([[made[0].id, { notes: "Size 10 shoes" }]]);
  });

  it("answers a name another row has with the website's sentence", async () => {
    updateRecipient.mockResolvedValue({ error: "You already have a recipient with this name" });
    const res = await PUT(put({ ...request(), name: "Mom" }), ctx);
    expect([res.status, await res.json()]).toEqual([422, { error: { code: "invalid", message: "You already have a recipient with this name" } }]);
  });

  it("refuses what the website's rules refuse, writing nothing", async () => {
    for (const [body, message] of [
      [{ key: "person:user_2momABC", notes: "x", name: "Mom" }, "That request wasn't valid."],
      [{ key: JOE, notes: "x" }, "Name is required"],
      [{ ...request(), notes: "a".repeat(501) }, "Notes must be less than 500 characters"],
    ] as const) {
      const res = await PUT(put(body), ctx);
      expect([res.status, (await res.json()).error]).toEqual([422, { code: "invalid", message }]);
    }
    expect(updateRecipient).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("refuses a name or notes with characters Rybn can't save, as the gift door does, writing nothing", async () => {
    for (const body of [
      { ...request(), name: "Grandpa\u0000Joe" },
      { ...request(), notes: "Size\u0000L" },
      { key: "person:user_2dadABC", notes: "Size 10\u0007" },
    ]) {
      const res = await PUT(put(body), ctx);
      const text = await res.text();
      expect([res.status, text === "" ? "" : JSON.parse(text).error])
        .toEqual([422, { code: "invalid", message: "That has characters Rybn can't save. Try typing it again." }]);
    }
    expect(updateRecipient).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 404 for a row that is not the caller's, a person they share nothing with, themselves, and any other key", async () => {
    // Dad's own row in his own tracker: the same table, but never Sam's.
    const dadsRow = "a1b2c3d4-0001-4d00-8000-000000000001";
    const w = world();
    holder.current.store = memoryGiftStore(SAM, {
      recipients: [
        ...w.recipients.map((r) => ({ ...r, user_id: SAM })),
        { id: dadsRow, name: "Sam", person_id: SAM, user_id: "user_2dadABC" },
      ],
    });
    holder.current.getSharedGroups.mockImplementation(async (id: string) =>
      (id === "user_2prySHA" ? { data: [] } : { data: [{ id: IDS.rivera, name: "Rivera Family", type: "family", description: null }] }));
    for (const body of [
      { ...request(), key: "recipient:" + crypto.randomUUID() },
      { ...request(), key: "recipient:" + dadsRow },
      { key: "person:user_2prySHA", notes: "x" },
      { key: "person:user_2abcDEF", notes: "x" },
      { key: "group:x", notes: "x" },
    ]) {
      const res = await PUT(put(body), ctx);
      expect([body.key, res.status, (await res.json()).error]).toEqual([body.key, 404, { code: "not_found", message: "That isn't there any more." }]);
    }
    expect(holder.current.getSharedGroups.mock.calls).toEqual([["user_2prySHA"]]);
    expect(updateRecipient).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 404 for a person whose profile the caller cannot read", async () => {
    holder.current.profiles.mockResolvedValue(new Map());
    const res = await PUT(put({ key: "person:user_2dadABC", notes: "x" }), ctx);
    expect(res.status).toBe(404);
    expect(updateRecipient).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 401 when nobody is signed in, and 500 without the database's words for any other failure", async () => {
    updateRecipient.mockResolvedValueOnce({ error: "Not authenticated" });
    expect((await PUT(put(request()), ctx)).status).toBe(401);

    updateRecipient.mockResolvedValueOnce({ error: "connection reset" });
    const res = await PUT(put(request()), ctx);
    const text = await res.text();
    expect([res.status, JSON.parse(text).error.code]).toEqual([500, "server_error"]);
    expect(text).not.toMatch(/connection/);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/gifts/notes"), expect.anything());
  });

  it("answers 401 when the shared groups cannot be read for want of a sign-in, writing nothing", async () => {
    holder.current.getSharedGroups.mockResolvedValue({ error: "Not authenticated" });
    expect((await PUT(put({ key: "person:user_2dadABC", notes: "x" }), ctx)).status).toBe(401);
    expect(updateRecipient).not.toHaveBeenCalled();
    expect(holder.current.store.writes).toEqual([]);
  });

  it("answers 401 without a bearer, saving nothing", async () => {
    const res = await PUT(new Request("http://localhost/api/mobile/v1/gifts/notes", { method: "PUT", body: JSON.stringify(request()) }), ctx);
    expect(res.status).toBe(401);
    expect(updateRecipient).not.toHaveBeenCalled();
  });
});
