import { describe, it, expect, vi, beforeEach } from "vitest";

type Result = { data: unknown; error: unknown };
const calls: [string, ...unknown[]][] = [];
let scripted: Result[] = [];
const next = (): Promise<Result> => Promise.resolve(scripted.shift() ?? { data: null, error: null });

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (...a: unknown[]) => {
      calls.push(["from", ...a]);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "insert", "update", "delete", "eq", "is", "in", "order", "range"]) {
        chain[m] = (...args: unknown[]) => {
          calls.push([m, ...args]);
          return chain;
        };
      }
      chain.single = () => {
        calls.push(["single"]);
        return next();
      };
      chain.maybeSingle = () => {
        calls.push(["maybeSingle"]);
        return next();
      };
      chain.then = (resolve: (r: Result) => unknown, reject: (e: unknown) => unknown) => next().then(resolve, reject);
      return chain;
    },
  }),
}));

const { createGiftStore } = await import("./gift-store-live");

const ME = "user_2abcDEF";
const GIFT_COLUMNS =
  "id, recipient_id, name, description, photo_url, product_link, price, status, wishlist_item_id, from_list, occasion_id, season_year, notes, is_archived, created_at, updated_at";
const NEW_GIFT = {
  recipient_id: "r1", name: "Scarf", description: null, photo_url: null, product_link: null, price: null, status: "planned" as const,
  wishlist_item_id: "i1", from_list: true, occasion_id: null, season_year: 2026, notes: null,
};
const callsOf = (name: string) => calls.filter((c) => c[0] === name).map((c) => c.slice(1));

beforeEach(() => {
  calls.length = 0;
  scripted = [];
});

describe("createGiftStore", () => {
  it("reads the caller's own claims with the columns it needs, and the owners' named columns", async () => {
    scripted = [
      {
        data: [{
          item_id: "i1", occasion_id: "o1", occasions: { occasion_date: "2026-12-25" },
          wishlist_items: { id: "i1", user_id: "user_2momABC", title: "Scarf", description: null, url: null, price: 89, image_url: null, purchased: false },
        }],
        error: null,
      },
      { data: [{ id: "user_2momABC", username: "maria", display_name: "Mom", avatar_url: null }], error: null },
    ];
    const claims = await (await createGiftStore(ME)).activeClaims();
    expect(calls.slice(0, 4)).toEqual([
      ["from", "wishlist_claims"],
      ["select", "item_id, occasion_id, occasions ( occasion_date ), wishlist_items ( id, user_id, title, description, url, price, image_url, purchased )"],
      ["eq", "claimed_by", ME],
      ["is", "released_at", null],
    ]);
    expect(calls.slice(4)).toEqual([
      ["order", "item_id", { ascending: true }],
      ["range", 0, 999],
      ["from", "user_profiles"],
      ["select", "id, username, display_name, avatar_url"],
      ["in", "id", ["user_2momABC"]],
    ]);
    expect(claims).toEqual([{
      itemId: "i1", occasionId: "o1", occasionDate: "2026-12-25",
      item: { id: "i1", ownerId: "user_2momABC", title: "Scarf", description: null, url: null, price: 89, imageValue: null, purchased: false },
      owner: { id: "user_2momABC", username: "maria", display_name: "Mom", avatar_url: null },
    }]);
  });

  it("makes no owner query when there are no claims", async () => {
    scripted = [{ data: [], error: null }];
    expect(await (await createGiftStore(ME)).activeClaims()).toEqual([]);
    expect(callsOf("from")).toEqual([["wishlist_claims"]]);
  });

  it("maps a claim whose item cannot be seen to item null", async () => {
    scripted = [
      { data: [{ item_id: "i1", occasion_id: null, occasions: null, wishlist_items: null }], error: null },
    ];
    expect(await (await createGiftStore(ME)).activeClaims()).toEqual([
      { itemId: "i1", occasionId: null, occasionDate: null, item: null, owner: null },
    ]);
    expect(callsOf("from")).toEqual([["wishlist_claims"]]);
  });

  it("filters every gift read and write to the caller", async () => {
    const store = await createGiftStore(ME);
    scripted = [{ data: [], error: null }];
    await store.gifts();
    expect(callsOf("from")).toEqual([["tracked_gifts"]]);
    expect(callsOf("select")).toEqual([[GIFT_COLUMNS]]);
    expect(callsOf("order")).toEqual([["created_at", { ascending: true }], ["id", { ascending: true }]]);
    expect(callsOf("range")).toEqual([[0, 999]]);
    expect(callsOf("eq")).toEqual([["user_id", ME]]);

    calls.length = 0;
    scripted = [{ data: { id: "g1" }, error: null }];
    await store.updateGift("g1", { status: "ordered" });
    expect(callsOf("from")).toEqual([["tracked_gifts"]]);
    expect(callsOf("maybeSingle")).toHaveLength(1); expect(callsOf("single")).toHaveLength(0);
    expect(callsOf("update")).toEqual([[{ status: "ordered" }]]);
    expect(callsOf("eq")).toEqual([["id", "g1"], ["user_id", ME]]);
    expect(callsOf("select")).toEqual([[GIFT_COLUMNS]]);

    calls.length = 0;
    scripted = [{ data: null, error: null }];
    await store.deleteGift("g1");
    expect(callsOf("from")).toEqual([["tracked_gifts"]]);
    expect(callsOf("delete")).toEqual([[]]);
    expect(callsOf("eq")).toEqual([["id", "g1"], ["user_id", ME]]);

    calls.length = 0;
    scripted = [{ data: { id: "g2" }, error: null }];
    await store.insertGift(NEW_GIFT);
    expect(callsOf("from")).toEqual([["tracked_gifts"]]);
    expect(callsOf("single")).toHaveLength(1); expect(callsOf("maybeSingle")).toHaveLength(0);
    expect(callsOf("insert")).toEqual([[{ user_id: ME, ...NEW_GIFT }]]);
    expect(callsOf("select")).toEqual([[GIFT_COLUMNS]]);

    calls.length = 0;
    scripted = [{ data: [], error: null }];
    await store.recipients();
    expect(callsOf("from")).toEqual([["gift_recipients"]]);
    expect(callsOf("select")).toEqual([["id, name, person_id"]]);
    expect(callsOf("eq")).toEqual([["user_id", ME]]);

    calls.length = 0;
    scripted = [{ data: { id: "r1", name: "Dad", person_id: "p" }, error: null }];
    await store.insertRecipient({ name: "Dad", person_id: "p" });
    expect(callsOf("from")).toEqual([["gift_recipients"]]);
    expect(callsOf("single")).toHaveLength(1);
    expect(callsOf("insert")).toEqual([[{ user_id: ME, name: "Dad", person_id: "p" }]]);
    expect(callsOf("select")).toEqual([["id, name, person_id"]]);
  });

  it.each([["gifts"], ["recipients"], ["activeClaims"]] as const)(
    "%s asks again for the next range when a page comes back full, and not when it comes back short", async (method) => {
      const store = await createGiftStore(ME);
      const row = method === "recipients" ? { id: "r", name: "n", person_id: null }
        : method === "gifts" ? { id: "g" }
        : { item_id: "i", occasion_id: null, occasions: null, wishlist_items: null };
      const full = Array.from({ length: 1000 }, () => row);
      scripted = [{ data: full, error: null }, { data: [row, row], error: null }];
      expect(await store[method]()).toHaveLength(1002);
      expect(callsOf("range")).toEqual([[0, 999], [1000, 1999]]);

      calls.length = 0;
      scripted = [{ data: [row], error: null }];
      expect(await store[method]()).toHaveLength(1);
      expect(callsOf("range")).toEqual([[0, 999]]);

      scripted = [{ data: full, error: null }, { data: null, error: { code: "XX000", message: "later" } }];
      await expect(store[method]()).rejects.toMatchObject({ message: `${method} failed: later`, code: "XX000" });
    },
  );

  it("answers null when no gift of the caller's was updated", async () => {
    scripted = [{ data: null, error: null }];
    expect(await (await createGiftStore(ME)).updateGift("g9", { status: "ordered" })).toBeNull();
  });

  it("makes the update conditional on the stored status when told what it should be", async () => {
    scripted = [{ data: { id: "g1" }, error: null }];
    await (await createGiftStore(ME)).updateGift("g1", { status: "ordered" }, { status: "planned" });
    expect(callsOf("eq")).toEqual([["id", "g1"], ["user_id", ME], ["status", "planned"]]);
    calls.length = 0;
    scripted = [{ data: null, error: null }];
    expect(await (await createGiftStore(ME)).updateGift("g1", { status: "ordered" }, { status: "planned" })).toBeNull();
  });

  it("names the clash from the index", async () => {
    const store = await createGiftStore(ME);
    const clash = (message: string) => ({ data: null, error: { code: "23505", message } });
    scripted = [clash('duplicate key value violates unique constraint "gift_recipients_one_per_person"')];
    expect(await store.insertRecipient({ name: "Dad", person_id: "p" })).toEqual({ ok: false, clash: "person" });
    scripted = [clash('duplicate key value violates unique constraint "gift_recipients_user_id_name_key"')];
    expect(await store.insertRecipient({ name: "Dad", person_id: "p" })).toEqual({ ok: false, clash: "name" });
    scripted = [clash('duplicate key value violates unique constraint "tracked_gifts_one_per_item"')];
    expect(await store.insertGift(NEW_GIFT)).toEqual({ ok: false, clash: "item" });
    scripted = [clash('duplicate key value violates unique constraint "tracked_gifts_one_per_item"')];
    expect(await store.updateGift("g1", { wishlist_item_id: "i1" })).toEqual({ ok: false, clash: "item" });
  });

  it("throws on any other database error, naming the method", async () => {
    const store = await createGiftStore(ME);
    scripted = [{ data: null, error: { code: "XX000", message: "boom" } }];
    await expect(store.insertGift(NEW_GIFT)).rejects.toMatchObject({ message: "insertGift failed: boom", code: "XX000" });
    scripted = [{ data: null, error: { code: "23505", message: 'unique constraint "something_else"' } }];
    await expect(store.insertGift(NEW_GIFT)).rejects.toMatchObject({ message: 'insertGift failed: unique constraint "something_else"', code: "23505" });
    scripted = [{ data: null, error: { code: "XX000", message: "boom" } }];
    await expect(store.gifts()).rejects.toMatchObject({ message: "gifts failed: boom", code: "XX000" });
    scripted = [{ data: null, error: { code: "XX000", message: "boom" } }];
    await expect(store.deleteGift("g1")).rejects.toMatchObject({ message: "deleteGift failed: boom", code: "XX000" });
  });

  it("refuses a picture path in someone else's folder before writing", async () => {
    const store = await createGiftStore(ME);
    await expect(store.insertGift({ ...NEW_GIFT, photo_url: "user_other/1-a.jpg" })).rejects.toThrow();
    await expect(store.updateGift("g1", { photo_url: "user_other/1-a.jpg" })).rejects.toThrow();
    expect(callsOf("insert")).toEqual([]);
    expect(callsOf("update")).toEqual([]);
  });

  it("never lets a field of the row override the caller's id", async () => {
    scripted = [{ data: { id: "g2" }, error: null }];
    await (await createGiftStore(ME)).insertGift({ ...NEW_GIFT, user_id: "user_other" } as typeof NEW_GIFT);
    expect(callsOf("insert")[0][0]).toMatchObject({ user_id: ME });
  });

  it("writes a picture that is the caller's own or an outside address", async () => {
    const store = await createGiftStore(ME);
    scripted = [{ data: { id: "g2" }, error: null }];
    await store.insertGift({ ...NEW_GIFT, photo_url: "https://images.example.com/a.jpg" });
    expect(callsOf("insert")[0][0]).toMatchObject({ photo_url: "https://images.example.com/a.jpg" });
  });
});
