import { describe, it, expect, vi, beforeEach } from "vitest";

type Result = { data: unknown; error: unknown };
const calls: [string, ...unknown[]][] = [];
let scripted: Result[] = [];
const next = (): Promise<Result> => Promise.resolve(scripted.shift() ?? { data: [], error: null });
const withSignedWishlistImages = vi.fn();
const getUpcomingOccasions = vi.fn();
const getSharedGroups = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (...a: unknown[]) => {
      calls.push(["from", ...a]);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push([m, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject);
      return chain;
    },
  }),
}));
vi.mock("@/lib/supabase/signed-image", () => ({
  withSignedWishlistImages: (...a: unknown[]) => withSignedWishlistImages(...a),
}));
vi.mock("@/lib/actions/occasions", () => ({ getUpcomingOccasions: (...a: unknown[]) => getUpcomingOccasions(...a) }));
vi.mock("@/lib/actions/profile", () => ({ getSharedGroups: (...a: unknown[]) => getSharedGroups(...a) }));

const people = await import("./people-live");
const { IDS, world } = await import("./test-shopping");

const callsOf = (name: string) => calls.filter((c) => c[0] === name).map((c) => c.slice(1));
const PERSON = "id, username, display_name, avatar_url";
const OCCASION = "id, kind, name, occasion_date, celebrant_id, partner_id, group_id, groups ( name )";

beforeEach(() => {
  calls.length = 0;
  scripted = [];
  vi.clearAllMocks();
});

describe("people-live", () => {
  it("reads people by their four named columns, never the email", async () => {
    scripted = [{ data: [{ id: "u1", username: "a", display_name: "A", avatar_url: null, email: "a@example.com" }], error: null }];
    const found = await people.profiles(["u1", "u1"]);
    expect(callsOf("select")).toEqual([[PERSON]]);
    expect(callsOf("in")).toEqual([["id", ["u1"]]]);
    expect(found.get("u1")).toEqual({ id: "u1", username: "a", display_name: "A", avatar_url: null });
  });

  it("reads occasions without created_by", async () => {
    await people.occasionRows(["o1"]);
    expect(callsOf("from")).toEqual([["occasions"]]);
    expect(callsOf("select")).toEqual([[OCCASION]]);
    expect(String(callsOf("select")[0][0])).not.toContain("created_by");
  });

  it("counts members and visible items per id", async () => {
    scripted = [{ data: [{ group_id: "a" }, { group_id: "a" }, { group_id: "b" }], error: null }];
    expect(await people.memberCounts(["a", "b"])).toEqual(new Map([["a", 2], ["b", 1]]));
    expect(callsOf("select")).toEqual([["group_id"]]);
    scripted = [{ data: [{ user_id: "a" }, { user_id: "a" }, { user_id: "b" }], error: null }];
    expect(await people.visibleItemCounts(["a", "b"])).toEqual(new Map([["a", 2], ["b", 1]]));
    expect(callsOf("select")[1]).toEqual(["user_id"]);
  });

  it("lists a group's members with their named columns, leaving out anyone whose profile is hidden", async () => {
    scripted = [
      { data: [{ group_id: "g", user_id: "u1" }, { group_id: "g", user_id: "u2" }], error: null },
      { data: [{ id: "u1", username: "a", display_name: "A", avatar_url: null }], error: null },
    ];
    expect(await people.groupMembers(["g"])).toEqual(
      new Map([["g", [{ id: "u1", username: "a", display_name: "A", avatar_url: null }]]]),
    );
    expect(callsOf("select")).toEqual([["group_id, user_id"], [PERSON]]);
  });

  it("signs linked items' pictures for the viewer, and keeps only the named fields", async () => {
    const rows = [{ id: "i1", user_id: "user_2momABC", image_url: "p/x.jpg", purchased: false }];
    scripted = [{ data: rows, error: null }];
    withSignedWishlistImages.mockResolvedValue([{ ...rows[0], image_url: "https://signed", image_path: null }]);
    const found = await people.linkedItems(["i1"], "user_2abcDEF");
    expect(withSignedWishlistImages).toHaveBeenCalledWith(rows, "user_2abcDEF");
    expect(callsOf("select")).toEqual([["id, user_id, image_url, purchased"]]);
    expect(found).toEqual(new Map([["i1", { id: "i1", ownerId: "user_2momABC", purchased: false, imageUrl: "https://signed" }]]));
  });

  it("asks for nothing when given no ids", async () => {
    expect(await people.profiles([])).toEqual(new Map());
    expect(await people.groupMembers([])).toEqual(new Map());
    expect(await people.memberCounts([])).toEqual(new Map());
    expect(await people.visibleItemCounts([])).toEqual(new Map());
    expect(await people.occasionRows([])).toEqual([]);
    expect(await people.linkedItems([], "u")).toEqual(new Map());
    expect(callsOf("from")).toEqual([]);
  });

  it("throws the function's name and the database's words on an error", async () => {
    scripted = [{ data: null, error: { message: "boom" } }];
    await expect(people.occasionRows(["o1"])).rejects.toThrow("occasionRows failed: boom");
  });

  it("looks a year ahead, answering 401 for nobody and throwing for a failure", async () => {
    getUpcomingOccasions.mockResolvedValue({ data: world().upcoming });
    expect(await people.upcomingForCaller()).toEqual(world().upcoming);
    expect(getUpcomingOccasions).toHaveBeenCalledWith(365);
    getUpcomingOccasions.mockResolvedValue({ error: "Not authenticated" });
    expect(((await people.upcomingForCaller()) as Response).status).toBe(401);
    getUpcomingOccasions.mockResolvedValue({ error: "Failed to load upcoming occasions." });
    await expect(people.upcomingForCaller()).rejects.toThrow("getUpcomingOccasions failed");
  });

  it("names the occasions that involve a person: their own, and group dates of groups both are in", async () => {
    getUpcomingOccasions.mockResolvedValue({ data: world().upcoming });
    getSharedGroups.mockResolvedValue({ data: [{ id: IDS.rivera, name: "Rivera Family", type: "family", description: null }] });
    const found = (await people.occasionsForPerson("user_2momABC")) as { kind: string; occasionDate: string }[];
    expect(found.map((o) => [o.kind, o.occasionDate])).toEqual([["group_date", "2026-12-25"], ["birthday", "2027-01-14"]]);
  });
});
