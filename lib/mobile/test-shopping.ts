// Tests only. The rows behind every shopping fixture: each fixture is what the pure functions make of them.
import {
  buildGiftViews,
  heldItemIds,
  type ClaimRow,
  type GiftContext,
  type GiftRow,
  type GiftView,
  type LinkedItem,
  type RecipientRow,
  type StoredGift,
} from "./gifts";
import { occasionFromRow, type OccasionRow, type PersonRow } from "./occasions";
import type { ListItemRow } from "./shopping";
import type { UpcomingOccasion } from "@/lib/occasions/display";

export const TODAY = "2026-11-11";
export const SAM = "user_2abcDEF";

export const IDS: Record<
  | "rivera" | "bookClub" | "xmas" | "xmasKey" | "momBirthday" | "dutchOven" | "scarf" | "kindle" | "gloves"
  | "catan" | "recipientMom" | "recipientAlex" | "recipientJoe" | "giftScarf" | "giftPhotoBook" | "giftCatan"
  | "giftHat" | "giftGloves",
  string
> = {
  rivera: "7d1e5b3c-9a2f-4c6d-8e0b-1f2a3b4c5d6e",
  bookClub: "2b8f6c4a-1e3d-4f5a-9b7c-0d1e2f3a4b5c",
  xmas: "9c4b2e1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c",
  xmasKey: "group_date:9c4b2e1a-7d3f-4e5a-8b6c-1d2e3f4a5b6c",
  momBirthday: "4e2a9c7b-5d1f-4a3e-9b8c-6f7a8b9c0d1e",
  dutchOven: "d0a1b2c3-0001-4a00-8000-000000000001",
  scarf: "d0a1b2c3-0002-4a00-8000-000000000002",
  kindle: "d0a1b2c3-0003-4a00-8000-000000000003",
  gloves: "d0a1b2c3-0004-4a00-8000-000000000004",
  catan: "d0a1b2c3-0005-4a00-8000-000000000005",
  recipientMom: "f0e1d2c3-0001-4c00-8000-000000000001",
  recipientAlex: "f0e1d2c3-0002-4c00-8000-000000000002",
  recipientJoe: "f0e1d2c3-0003-4c00-8000-000000000003",
  giftScarf: "e1f2a3b4-0001-4b00-8000-000000000001",
  giftPhotoBook: "e1f2a3b4-0002-4b00-8000-000000000002",
  giftCatan: "e1f2a3b4-0003-4b00-8000-000000000003",
  giftHat: "e1f2a3b4-0004-4b00-8000-000000000004",
  giftGloves: "e1f2a3b4-0005-4b00-8000-000000000005",
};

const SIGN = (p: string) => `https://example.supabase.co/storage/v1/object/sign/wishlist-images/${p}?token=fixture`;
const signedGiftPhoto = (path: string) => `https://example.supabase.co/storage/v1/object/sign/gift-photos/${path}?token=fixture`;

export function world() {
  const people: Record<"sam" | "mom" | "dad" | "alex" | "jordan" | "gran" | "priya", PersonRow> = {
    sam: { id: "user_2abcDEF", username: "sam", display_name: "Sam Rivera", avatar_url: "https://img.clerk.com/abc" },
    mom: { id: "user_2momABC", username: "maria", display_name: "Mom", avatar_url: "https://img.clerk.com/mom" },
    dad: { id: "user_2dadABC", username: "luis", display_name: "Dad", avatar_url: null },
    alex: { id: "user_2alxABC", username: "alex", display_name: "Alex Rivera", avatar_url: "https://img.clerk.com/alex" },
    jordan: { id: "user_2jrdABC", username: "jordan", display_name: null, avatar_url: null },
    gran: { id: "user_2grnABC", username: "gran", display_name: "Gran", avatar_url: null },
    priya: { id: "user_2prySHA", username: "priya", display_name: "Priya Shah", avatar_url: null },
  };
  const profiles = new Map<string, PersonRow>(Object.values(people).map((p) => [p.id, p]));
  const members = new Map<string, PersonRow[]>([
    [IDS.rivera, [people.sam, people.mom, people.dad, people.alex, people.jordan, people.gran]],
    [IDS.bookClub, [people.sam, people.priya, people.alex]],
  ]);
  const memberCounts = new Map<string, number>([[IDS.rivera, 6], [IDS.bookClub, 3]]);
  const itemCounts = new Map<string, number>([
    [people.alex.id, 2], [people.dad.id, 3], [people.gran.id, 0], [people.jordan.id, 1],
    [people.mom.id, 4], [people.sam.id, 4], [people.priya.id, 5],
  ]);

  const upcoming: UpcomingOccasion[] = [
    { occasionId: null, kind: "birthday", name: null, occasionDate: "2026-11-30", celebrantId: people.sam.id,
      celebrantUsername: "sam", celebrantDisplayName: "Sam Rivera", groupId: null, groupName: null,
      partnerId: null, partnerUsername: null, partnerDisplayName: null },
    { occasionId: IDS.xmas, kind: "group_date", name: "Christmas 2026", occasionDate: "2026-12-25", celebrantId: null,
      celebrantUsername: null, celebrantDisplayName: null, groupId: IDS.rivera, groupName: "Rivera Family",
      partnerId: null, partnerUsername: null, partnerDisplayName: null },
    { occasionId: IDS.momBirthday, kind: "birthday", name: null, occasionDate: "2027-01-14", celebrantId: people.mom.id,
      celebrantUsername: "maria", celebrantDisplayName: "Mom", groupId: null, groupName: null,
      partnerId: null, partnerUsername: null, partnerDisplayName: null },
    { occasionId: null, kind: "birthday", name: null, occasionDate: "2027-02-03", celebrantId: people.priya.id,
      celebrantUsername: "priya", celebrantDisplayName: "Priya Shah", groupId: null, groupName: null,
      partnerId: null, partnerUsername: null, partnerDisplayName: null },
  ];
  const occasionRows: OccasionRow[] = [
    { id: IDS.xmas, kind: "group_date", name: "Christmas 2026", occasion_date: "2026-12-25", celebrant_id: null,
      partner_id: null, group_id: IDS.rivera, groups: { name: "Rivera Family" } },
    { id: IDS.momBirthday, kind: "birthday", name: null, occasion_date: "2027-01-14", celebrant_id: people.mom.id,
      partner_id: null, group_id: null, groups: null },
  ];

  const momItem = (
    id: string, title: string, description: string | null, url: string | null, price: number, image: string | null,
    priority: ListItemRow["priority"], stockMarkedBy: string | null, created: string,
  ): ListItemRow => ({
    id, user_id: people.mom.id, title, description, url, price, image_url: image, priority, purchased: false,
    out_of_stock_marked_by: stockMarkedBy, created_at: created,
  });
  const momItems: ListItemRow[] = [
    momItem(IDS.kindle, "Kindle Paperwhite", null, "https://www.example.com/kindle", 159.99, null, "high", null,
      "2026-09-15T10:00:00.000000+00:00"),
    momItem(IDS.dutchOven, "Le Creuset Dutch oven", "5.5 qt, Flame", "https://www.example.com/dutch-oven", 419.95,
      SIGN("user_2momABC/1793000000000-d7c1.jpg"), "must-have", null, "2026-10-01T10:00:00.000000+00:00"),
    momItem(IDS.gloves, "Garden gloves", null, null, 18, null, "low", people.dad.id, "2026-08-01T10:00:00.000000+00:00"),
    momItem(IDS.scarf, "Cashmere scarf", "Grey, the long one", "https://www.example.com/cashmere-scarf", 89,
      SIGN("user_2momABC/1793100000000-s2c4.jpg"), "high", null, "2026-10-20T10:00:00.000000+00:00"),
  ];
  const activeClaims: Record<string, { claimedBy: string; occasionId: string | null }> = {
    [IDS.scarf]: { claimedBy: people.sam.id, occasionId: IDS.xmas },
    [IDS.kindle]: { claimedBy: people.dad.id, occasionId: null },
  };
  const tags: Record<string, string[]> = {
    [IDS.dutchOven]: [IDS.xmas],
    [IDS.scarf]: [IDS.xmas, IDS.momBirthday],
  };

  const recipients: RecipientRow[] = [
    { id: IDS.recipientMom, name: "Mom", person_id: people.mom.id },
    { id: IDS.recipientAlex, name: "Alex Rivera", person_id: people.alex.id },
    { id: IDS.recipientJoe, name: "Grandpa Joe", person_id: null },
  ];
  const gift = (
    id: string, recipient: string, name: string, description: string | null, photo: string | null, link: string | null,
    price: number, status: StoredGift["status"], item: string | null, fromList: boolean, occasion: string | null,
    year: number, notes: string | null, created: string, updated: string,
  ): StoredGift => ({
    id, recipient_id: recipient, name, description, photo_url: photo, product_link: link, price, status,
    wishlist_item_id: item, from_list: fromList, occasion_id: occasion, season_year: year, notes, is_archived: false,
    created_at: created, updated_at: updated,
  });
  const gifts: StoredGift[] = [
    gift(IDS.giftGloves, IDS.recipientJoe, "Wool gloves", null, null, null, 15, "given", null, false, null, 2025, null,
      "2025-12-20T09:00:00.000000+00:00", "2025-12-26T09:00:00.000000+00:00"),
    gift(IDS.giftHat, IDS.recipientJoe, "Fishing hat", null, null, null, 22, "given", null, false, null, 2026, null,
      "2026-03-02T09:00:00.000000+00:00", "2026-03-15T12:00:00.000000+00:00"),
    gift(IDS.giftCatan, IDS.recipientAlex, "Catan", null, null, "https://www.example.com/catan", 49.99, "ordered",
      IDS.catan, true, IDS.xmas, 2026, "Ships Dec 3", "2026-11-01T18:30:00.000000+00:00", "2026-11-10T08:00:00.000000+00:00"),
    gift(IDS.giftScarf, IDS.recipientMom, "Cashmere scarf", "Grey, the long one", null,
      "https://www.example.com/cashmere-scarf", 89, "planned", IDS.scarf, true, IDS.xmas, 2026, null,
      "2026-11-08T19:22:05.120000+00:00", "2026-11-08T19:22:05.120000+00:00"),
    gift(IDS.giftPhotoBook, IDS.recipientMom, "Photo book", "Our trip to Lisbon", "user_2abcDEF/1794500000000-p4b8.jpg",
      null, 35, "ordered", null, false, IDS.xmas, 2026, null, "2026-11-09T20:00:00.000000+00:00",
      "2026-11-09T21:10:00.000000+00:00"),
  ];

  const claims: ClaimRow[] = [
    { itemId: IDS.scarf, occasionId: IDS.xmas, occasionDate: "2026-12-25", claimedAt: "2026-11-08T19:21:40.000000+00:00", owner: people.mom,
      item: { id: IDS.scarf, ownerId: people.mom.id, title: "Cashmere scarf", description: "Grey, the long one",
        url: "https://www.example.com/cashmere-scarf", price: 89, imageValue: "user_2momABC/1793100000000-s2c4.jpg",
        purchased: false } },
    { itemId: IDS.catan, occasionId: IDS.xmas, occasionDate: "2026-12-25", claimedAt: "2026-11-01T18:29:00.000000+00:00", owner: people.alex,
      item: { id: IDS.catan, ownerId: people.alex.id, title: "Catan", description: null,
        url: "https://www.example.com/catan", price: 49.99, imageValue: null, purchased: true } },
  ];
  const linkedItems = new Map<string, LinkedItem>([
    [IDS.scarf, { id: IDS.scarf, ownerId: people.mom.id, purchased: false,
      imageUrl: SIGN("user_2momABC/1793100000000-s2c4.jpg") }],
    [IDS.catan, { id: IDS.catan, ownerId: people.alex.id, purchased: true, imageUrl: null }],
  ]);

  function giftRows(): GiftRow[] {
    return gifts.map((g) => ({
      ...g,
      photo_url: g.photo_url === null ? null : signedGiftPhoto(g.photo_url),
      photo_path: g.photo_url,
    }));
  }
  function giftContext(): GiftContext & {
    recipients: Map<string, RecipientRow>; items: Map<string, LinkedItem>; held: Set<string>;
  } {
    return {
      recipients: new Map(recipients.map((r) => [r.id, r])),
      items: new Map(linkedItems),
      held: heldItemIds(claims, TODAY),
      claimedAt: new Map(claims.map((c) => [c.itemId, c.claimedAt])),
      occasions: new Map(occasionRows.map((r) => [r.id, occasionFromRow(r, profiles)])),
      profiles,
      today: TODAY,
    };
  }
  function giftViews(): GiftView[] {
    return buildGiftViews(giftRows(), giftContext());
  }

  return {
    people, profiles, members, memberCounts, itemCounts, upcoming, occasionRows, momItems, activeClaims, tags,
    recipients, gifts, claims, linkedItems, signedGiftPhoto, giftRows, giftContext, giftViews,
  };
}
