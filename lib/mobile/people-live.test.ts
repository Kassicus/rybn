import { describe, it, expect, vi, beforeEach } from "vitest";

type Result = { data: unknown; error: unknown; count?: number | null };
let responder: ((local: [string, ...unknown[]][]) => Result) | null = null;
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
      const local: [string, ...unknown[]][] = [["from", ...a]];
      for (const m of ["select", "eq", "in"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push([m, ...args]);
          local.push([m, ...args]);
          return chain;
        };
      }
      chain.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) =>
        (responder ? Promise.resolve(responder(local)) : next()).then(resolve, reject);
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
  responder = null;
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
  });

  it("counts visible items on the database, one request per owner, from the reply's count and not its rows", async () => {
    responder = (local) => {
      const owner = local.find((c) => c[0] === "eq")![2] as string;
      // rows are a decoy: a head request returns none, and the count is all that is read
      return { data: [{ id: "x" }, { id: "y" }], count: owner === "a" ? 7 : owner === "b" ? 0 : null, error: null };
    };
    expect(await people.visibleItemCounts(["a", "b", "c", "a"])).toEqual(new Map([["a", 7], ["b", 0], ["c", 0]]));
    expect(callsOf("from")).toEqual([["wishlist_items"], ["wishlist_items"], ["wishlist_items"]]);
    expect(callsOf("select")).toEqual(Array(3).fill(["id", { count: "exact", head: true }]));
    expect(callsOf("eq").map((c) => c[0])).toEqual(["user_id", "user_id", "user_id"]);
    await expect((async () => { responder = () => ({ data: null, error: { message: "nope" } }); return people.visibleItemCounts(["a"]); })())
      .rejects.toThrow("visibleItemCounts failed: nope");
  });

  it("asks in chunks of at most 100 ids, in parallel, each id once, and merges the answers", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    responder = (local) => {
      const asked = local.find((c) => c[0] === "in")![2] as string[];
      const table = local[0][1];
      if (table === "user_profiles") return { data: asked.map((id) => ({ id, username: id, display_name: null, avatar_url: null })), error: null };
      if (table === "group_members") return { data: asked.map((g) => ({ group_id: g, user_id: "u1" })), error: null };
      if (table === "occasions") return { data: asked.map((id) => ({ id })), error: null };
      return { data: asked.map((id) => ({ id, user_id: "owner", image_url: null, purchased: false })), error: null };
    };
    withSignedWishlistImages.mockImplementation(async (rows: unknown[]) => rows);
    const askedFor = () => callsOf("in").map((c) => c[1] as string[]);
    const check = () => {
      const sizes = askedFor().map((a) => a.length).sort((a, b) => b - a);
      expect(sizes).toEqual([100, 100, 50]);
      expect(askedFor().flat().sort()).toEqual([...ids].sort());
      calls.length = 0;
    };
    expect((await people.occasionRows([...ids, ...ids])).length).toBe(250); check();
    expect((await people.memberCounts([...ids, "id1"])).size).toBe(250); check();
    expect((await people.linkedItems(ids, "viewer")).size).toBe(250); check();
    expect((await people.profiles(ids)).size).toBe(250); check();
    responder = (local) => {
      const table = local[0][1];
      const asked = local.find((c) => c[0] === "in")![2] as string[];
      return table === "group_members"
        ? { data: asked.map((g) => ({ group_id: g, user_id: "u1" })), error: null }
        : { data: [{ id: "u1", username: "u", display_name: null, avatar_url: null }], error: null };
    };
    expect((await people.groupMembers(ids)).size).toBe(250);
    expect(callsOf("from").filter((c) => c[0] === "group_members").length).toBe(3);
  });

  it("fails the whole read, with the function's name, when any chunk fails", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
    responder = (local) => ((local.find((c) => c[0] === "in")![2] as string[]).includes("id150")
      ? { data: null, error: { message: "chunk broke" } }
      : { data: [], error: null });
    await expect(people.occasionRows(ids)).rejects.toThrow("occasionRows failed: chunk broke");
    await expect(people.memberCounts(ids)).rejects.toThrow("memberCounts failed: chunk broke");
    await expect(people.linkedItems(ids, "v")).rejects.toThrow("linkedItems failed: chunk broke");
    await expect(people.profiles(ids)).rejects.toThrow("profiles failed: chunk broke");
    await expect(people.groupMembers(ids)).rejects.toThrow("groupMembers failed: chunk broke");
  });

  it("answers a viewer's own item as not bought, whatever the row says", async () => {
    const rows = [
      { id: "mine", user_id: "viewer", image_url: null, purchased: true },
      { id: "theirs", user_id: "other", image_url: null, purchased: true },
    ];
    scripted = [{ data: rows, error: null }];
    withSignedWishlistImages.mockResolvedValue(rows);
    const found = await people.linkedItems(["mine", "theirs"], "viewer");
    expect([found.get("mine")!.purchased, found.get("theirs")!.purchased]).toEqual([false, true]);
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

  it("leaves out a group date of a group the person is not in", async () => {
    const other = { ...world().upcoming[1], occasionId: "bbbbbbbb-3333-4333-8333-000000000001", groupId: IDS.bookClub,
      groupName: "Book Club", name: "Book Club party", occasionDate: "2027-02-01" };
    getUpcomingOccasions.mockResolvedValue({ data: [...world().upcoming, other] });
    getSharedGroups.mockResolvedValue({ data: [{ id: IDS.rivera, name: "Rivera Family", type: "family", description: null }] });
    const found = (await people.occasionsForPerson("user_2momABC")) as { groupId: string | null }[];
    expect(found.map((o) => o.groupId)).toEqual([IDS.rivera, null]);
  });

  it("answers 401 when getSharedGroups says nobody is signed in, and throws for any other failure", async () => {
    getUpcomingOccasions.mockResolvedValue({ data: world().upcoming });
    getSharedGroups.mockResolvedValue({ error: "Not authenticated" });
    expect(((await people.occasionsForPerson("user_2momABC")) as Response).status).toBe(401);
    getSharedGroups.mockResolvedValue({ error: "database words" });
    await expect(people.occasionsForPerson("user_2momABC")).rejects.toThrow("getSharedGroups failed: database words");
  });
});
