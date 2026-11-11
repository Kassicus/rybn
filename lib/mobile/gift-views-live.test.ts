import { describe, it, expect, vi, beforeEach } from "vitest";
import type { WorldMocks } from "./test-shopping-mocks";

const m = vi.hoisted(() => ({ current: undefined as unknown as WorldMocks }));

vi.mock("@/lib/mobile/people-live", () => ({
  profiles: (...a: unknown[]) => m.current.profiles(...a),
  groupMembers: (...a: unknown[]) => m.current.groupMembers(...a),
  memberCounts: (...a: unknown[]) => m.current.memberCounts(...a),
  visibleItemCounts: (...a: unknown[]) => m.current.visibleItemCounts(...a),
  occasionRows: (...a: unknown[]) => m.current.occasionRows(...a),
  linkedItems: (...a: unknown[]) => m.current.linkedItems(...a),
}));
vi.mock("@/lib/supabase/signed-image", () => ({
  withSignedGiftPhotos: (...a: unknown[]) => m.current.withSignedGiftPhotos(...a),
  withSignedGiftPhoto: (...a: unknown[]) => m.current.withSignedGiftPhoto(...a),
}));

const { loadGiftViews } = await import("./gift-views-live");
const { memoryGiftStore } = await import("./test-gift-store");
const { worldMocks } = await import("./test-shopping-mocks");
const { IDS, SAM, TODAY, world } = await import("./test-shopping");

const PAST = "aaaaaaaa-1111-4111-8111-000000000001";
const storeWith = (change: (g: ReturnType<typeof world>["gifts"][number]) => Partial<ReturnType<typeof world>["gifts"][number]>) => {
  const w = world();
  return memoryGiftStore(SAM, {
    claims: w.claims,
    gifts: w.gifts.map((g) => ({ ...g, ...change(g), user_id: SAM })),
    recipients: w.recipients.map((r) => ({ ...r, user_id: SAM })),
  });
};

beforeEach(() => {
  m.current = worldMocks();
});

describe("loadGiftViews", () => {
  it("gives the world's gift views", async () => expect(await loadGiftViews(SAM, m.current.store, TODAY)).toEqual(world().giftViews()));

  it("loads every occasion a gift is filed under, past ones included, so its season and date rule hold", async () => {
    m.current.occasionRows.mockImplementation(async (ids: string[]) => [
      ...world().occasionRows.filter((r) => ids.includes(r.id)),
      ...(ids.includes(PAST)
        ? [{ id: PAST, kind: "group_date" as const, name: "Christmas 2025", occasion_date: "2025-12-25", celebrant_id: null,
            partner_id: null, group_id: IDS.rivera, groups: { name: "Rivera Family" } }]
        : []),
    ]);
    // Created this year, filed under last year's Christmas: only the occasion's row says it belongs to 2025.
    const store = storeWith((g) => (g.id === IDS.giftHat ? { occasion_id: PAST } : {}));
    const views = await loadGiftViews(SAM, store, TODAY);
    expect(m.current.occasionRows).toHaveBeenCalledWith(expect.arrayContaining([PAST, IDS.xmas]));
    const hat = views.find((v) => v.gift.id === IDS.giftHat)!;
    expect(hat.gift.seasonYear).toBe(2025);
    expect(hat.gift.occasion).toMatchObject({ date: "2025-12-25", title: "Christmas 2025" });
  });

  it("treats an item the caller's own client does not return as gone: no picture, no bought information, nothing of its row", async () => {
    const store = storeWith((g) => (g.id === IDS.giftScarf ? { status: "ordered" as const } : {}));
    const seen = await loadGiftViews(SAM, store, TODAY);
    const control = seen.find((v) => v.gift.id === IDS.giftScarf)!.gift;
    expect([control.imageUrl, control.itemNotBought, control.itemGone]).toEqual([expect.stringContaining("wishlist-images"), true, false]);

    const linked = m.current.linkedItems.getMockImplementation()!;
    m.current.linkedItems.mockImplementation(async (ids: string[], viewer: string) => {
      const all: Map<string, unknown> = await linked(ids, viewer);
      all.delete(IDS.scarf);
      return all;
    });
    const views = await loadGiftViews(SAM, store, TODAY);
    const gift = views.find((v) => v.gift.id === IDS.giftScarf)!.gift;
    expect([gift.imageUrl, gift.itemNotBought, gift.itemGone, gift.canRelease]).toEqual([null, false, true, false]);
    expect(m.current.linkedItems).toHaveBeenLastCalledWith(expect.arrayContaining([IDS.scarf, IDS.catan]), SAM);
  });

  it("asks for the caller's own items only through linkedItems, with the caller as viewer", async () => {
    await loadGiftViews(SAM, m.current.store, TODAY);
    expect(m.current.linkedItems).toHaveBeenCalledWith(expect.arrayContaining([IDS.scarf, IDS.catan]), SAM);
  });
});
