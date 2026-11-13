// Tests only. The mocks every shopping route test shares, answering from world().
import { vi, type Mock } from "vitest";
import type { ClaimRow, ClaimedItem } from "./gifts";
import { memoryGiftStore, type MemoryGiftStore } from "./test-gift-store";
import { fixture, groupRows } from "./test-fixtures";
import { RIVERA_DESCRIPTION, roleIn } from "./test-groups";
import { IDS, SAM, TODAY, world } from "./test-shopping";

export type WorldMocks = { store: MemoryGiftStore; rpc: Mock; todayISO: Mock } & Record<
  | "getUpcomingOccasions" | "getMyGroups" | "getGroupById" | "getUserWishlist" | "getActiveClaims" | "getTagsForItems"
  | "getSharedGroups" | "getWishlistItem" | "releaseClaim" | "markAsPurchased" | "profiles" | "groupMembers"
  | "memberCounts" | "visibleItemCounts" | "occasionRows" | "linkedItems" | "withSignedGiftPhotos" | "withSignedGiftPhoto",
  Mock
>;

/** Sam's store: the world's gifts and recipients (user_id SAM) with these claims. The one store set-up Tasks 4–6 share. */
export function worldStore(claims: ClaimRow[] = world().claims): MemoryGiftStore {
  const w = world();
  return memoryGiftStore(SAM, {
    claims,
    gifts: w.gifts.map((g) => ({ ...g, user_id: SAM })),
    recipients: w.recipients.map((r) => ({ ...r, user_id: SAM })),
  });
}

const only = <V>(map: ReadonlyMap<string, V>, ids: string[]) =>
  new Map([...map].filter(([id]) => ids.includes(id)));

export function worldMocks(): WorldMocks {
  const w = world();
  const groups = new Map(
    fixture("groups").groups.map((g: { id: string; name: string; type: string }) => [g.id, g] as const),
  );
  const momLinked = new Map(
    w.momItems.map((r) => [r.id, { id: r.id, ownerId: w.people.mom.id, purchased: false, imageUrl: r.image_url }] as const),
  );
  const linked = new Map([...momLinked, [IDS.catan, w.linkedItems.get(IDS.catan)!]]);
  const restrict = <V>(record: Record<string, V>, ids: string[]) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => ids.includes(id)));

  return {
    store: worldStore(),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    todayISO: vi.fn(() => TODAY),
    getUpcomingOccasions: vi.fn(async () => ({ data: w.upcoming })),
    getMyGroups: vi.fn(async () => ({ data: groupRows() })),
    getGroupById: vi.fn(async (id: string) => {
      const group = groups.get(id) as { id: string; name: string; type: string } | undefined;
      if (!group) return { error: "Group not found" };
      return {
        data: {
          ...group,
          description: id === IDS.rivera ? RIVERA_DESCRIPTION : null,
          invite_code: "SECRET12",
          settings: {},
          created_at: "2026-01-01T00:00:00.000000+00:00",
          created_by: SAM,
          group_members: (w.members.get(id) ?? []).map((p, i) => ({
            id: `member-${i}`,
            user_id: p.id,
            role: roleIn(id, p.id),
            joined_at: "2026-01-02T00:00:00+00:00",
            user_profiles: { id: p.id, username: p.username, display_name: p.display_name, avatar_url: p.avatar_url },
          })),
        },
      };
    }),
    getUserWishlist: vi.fn(async (id: string) => ({
      data: id === w.people.mom.id ? w.momItems : [],
      currentUserId: SAM,
    })),
    getActiveClaims: vi.fn(async (ids: string[]) => ({ data: restrict(w.activeClaims, ids) })),
    getTagsForItems: vi.fn(async (ids: string[]) => ({ data: restrict(w.tags, ids) })),
    getSharedGroups: vi.fn(async (id: string) => ({
      data: [...w.members]
        .filter(([, people]) => people.some((p) => p.id === id))
        .map(([gid]) => ({ ...(groups.get(gid) as { id: string; name: string; type: string }), description: null })),
    })),
    getWishlistItem: vi.fn(async (id: string) => {
      const row = w.momItems.find((r) => r.id === id);
      return row ? { data: { ...row, image_path: null }, currentUserId: SAM } : { error: "Item not found", notFound: true };
    }),
    releaseClaim: vi.fn(async () => ({ data: null })),
    markAsPurchased: vi.fn(async () => ({ data: null })),
    profiles: vi.fn(async (ids: string[]) => only(w.profiles, ids)),
    groupMembers: vi.fn(async (ids: string[]) => only(w.members, ids)),
    memberCounts: vi.fn(async (ids: string[]) => only(w.memberCounts, ids)),
    visibleItemCounts: vi.fn(async (ids: string[]) => only(w.itemCounts, ids)),
    occasionRows: vi.fn(async (ids: string[]) => w.occasionRows.filter((r) => ids.includes(r.id))),
    linkedItems: vi.fn(async (ids: string[]) => only(linked, ids)),
    withSignedGiftPhotos: vi.fn(async (gifts: { photo_url: string | null }[]) =>
      gifts.map((g) => ({ ...g, photo_url: g.photo_url === null ? null : w.signedGiftPhoto(g.photo_url), photo_path: g.photo_url }))),
    withSignedGiftPhoto: vi.fn(async (g: { photo_url: string | null }) => ({
      ...g,
      photo_url: g.photo_url === null ? null : w.signedGiftPhoto(g.photo_url),
      photo_path: g.photo_url,
    })),
  };
}

/**
 * The owner hid this item from Sam, or Sam left the group they share: none of Sam's reads return the item any more
 * (the claim's embedded item and owner come back null), though his claim on it stands. Its gift keeps its item id.
 */
export function hideItem(mocks: WorldMocks, itemId: string): void {
  mocks.store = worldStore(world().claims.map((c) => (c.itemId === itemId ? { ...c, item: null, owner: null } : c)));
  const linked = mocks.linkedItems.getMockImplementation()!;
  mocks.linkedItems.mockImplementation(async (ids: string[]) => {
    const found = new Map(await linked(ids));
    found.delete(itemId);
    return found;
  });
  const item = mocks.getWishlistItem.getMockImplementation()!;
  mocks.getWishlistItem.mockImplementation(async (id: string) =>
    id === itemId ? { error: "Item not found", notFound: true } : item(id));
}

export function bearer(url: string, init: RequestInit = {}): Request {
  return new Request(url, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: "Bearer test-token" } });
}

/** Sam's claim on Mom's Dutch oven, made on the site yesterday for Mom's birthday: Task 3's `oven()`, moved here for Tasks 4–6. */
export function oven(over: Partial<ClaimRow> = {}, item: Partial<ClaimedItem> = {}): ClaimRow & { item: ClaimedItem } {
  const w = world();
  return {
    itemId: IDS.dutchOven, occasionId: IDS.momBirthday, occasionDate: "2027-01-14", claimedAt: "2026-11-10T09:00:00.000000+00:00",
    owner: w.people.mom, ...over,
    item: {
      id: IDS.dutchOven, ownerId: "user_2momABC", title: "Le Creuset Dutch oven", description: "5.5 qt, Flame",
      url: "https://www.example.com/dutch-oven", price: 419.95, imageValue: "user_2momABC/1793000000000-d7c1.jpg",
      purchased: false, ...item,
    },
  };
}
