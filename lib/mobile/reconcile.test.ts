import { describe, it, expect } from "vitest";
import type { ClaimRow, ClaimedItem, RecipientRow, StoredGift } from "./gifts";
import { memoryGiftStore, type MemoryGiftStore } from "./test-gift-store";
import { oven } from "./test-shopping-mocks";
import { IDS, SAM, TODAY, world } from "./test-shopping";
import { fileClaim, reconcileGifts, recipientFor } from "./reconcile";

const w = world();
const seeded = (extra: { claims?: ClaimRow[]; gifts?: StoredGift[]; recipients?: RecipientRow[]; replaceClaims?: boolean } = {}) =>
  memoryGiftStore(SAM, {
    claims: extra.replaceClaims ? extra.claims : [...w.claims, ...(extra.claims ?? [])],
    gifts: [...w.gifts, ...(extra.gifts ?? [])].map((g) => ({ ...g, user_id: SAM })),
    recipients: [...w.recipients, ...(extra.recipients ?? [])].map((r) => ({ ...r, user_id: SAM })),
  });
const copyOf = (over: Partial<StoredGift> = {}): StoredGift => ({ id: "aaaaaaaa-0000-4000-8000-000000000001", recipient_id: IDS.recipientJoe,
  name: "Le Creuset Dutch oven", description: null, photo_url: null, product_link: "https://www.example.com/dutch-oven", price: null,
  status: "planned", wishlist_item_id: null, from_list: false, occasion_id: null, season_year: 2026, notes: null, is_archived: false,
  created_at: "2026-10-02T10:00:00.000000+00:00", updated_at: "2026-10-02T10:00:00.000000+00:00", ...over });
const forItem = (s: MemoryGiftStore, itemId: string) => s.allGifts().filter((g) => g.wishlist_item_id === itemId);
const scarfClaim = (over: Partial<ClaimRow>, item: Partial<ClaimedItem> = {}) => ({ ...w.claims[0], ...over, item: { ...w.claims[0].item!, ...item } });

describe("reconcileGifts", () => {
  it("changes nothing in the fixture world", async () => { const s = seeded(); await reconcileGifts(s, TODAY); expect(s.writes).toEqual([]); });
  it("files a website claim as a gift at Claimed, for the item's owner, under the claim's occasion", async () => {   // D8
    const s = seeded({ claims: [oven()] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)).toEqual([expect.objectContaining({ recipient_id: IDS.recipientMom, name: "Le Creuset Dutch oven",
      description: "5.5 qt, Flame", product_link: "https://www.example.com/dutch-oven", price: 419.95, photo_url: null, status: "planned",
      from_list: true, occasion_id: IDS.momBirthday, season_year: 2027, notes: null })]);
  });
  it("copies the item's picture only when it is an outside address", async () => {
    const s = seeded({ claims: [oven({}, { imageValue: "https://images.example.com/oven.jpg" })] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0].photo_url).toBe("https://images.example.com/oven.jpg");
  });
  it("files an item whose picture is on rybn's own storage host with no picture, and still answers", async () => {
    const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname;
    const s = seeded({ claims: [oven({}, { imageValue: `https://${host}/storage/v1/object/sign/wishlist-images/user_2momABC/x.jpg?token=t` })] });
    await expect(reconcileGifts(s, TODAY)).resolves.toBeUndefined();
    expect(forItem(s, IDS.dutchOven)[0].photo_url).toBeNull();
  });
  it("files a claim on a bought item at Ordered", async () => {
    const s = seeded({ claims: [oven({}, { purchased: true })] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0].status).toBe("ordered");
  });
  it("files a claim with no occasion under No occasion, in this year's season", async () => {
    const s = seeded({ claims: [oven({ occasionId: null, occasionDate: null })] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0]).toMatchObject({ occasion_id: null, season_year: 2026 });
  });
  it("makes a recipient named after a person who has none", async () => {
    const s = seeded({ claims: [oven({ owner: w.people.dad }, { ownerId: "user_2dadABC" })] }); await reconcileGifts(s, TODAY);
    expect(s.allRecipients().filter((r) => r.person_id === "user_2dadABC")).toEqual([expect.objectContaining({ name: "Dad" })]);
  });
  it("links an exact hand-made copy instead of adding a gift, keeping its typed recipient", async () => {   // D15
    const s = seeded({ claims: [oven()], gifts: [copyOf()] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)).toEqual([expect.objectContaining({ id: "aaaaaaaa-0000-4000-8000-000000000001",
      recipient_id: IDS.recipientJoe, from_list: true, occasion_id: IDS.momBirthday, season_year: 2027, status: "planned" })]);
    expect(s.writes.filter((x) => x.startsWith("insert"))).toEqual([]);
  });
  it("links the oldest of several exact copies", async () => {
    const younger = copyOf({ id: "aaaaaaaa-0000-4000-8000-000000000002", created_at: "2026-10-05T10:00:00.000000+00:00" });
    const s = seeded({ claims: [oven()], gifts: [younger, copyOf()] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven).map((g) => g.id)).toEqual(["aaaaaaaa-0000-4000-8000-000000000001"]);
  });
  it("counts two empty links as equal", async () => {
    const s = seeded({ claims: [oven({}, { url: null })], gifts: [copyOf({ product_link: null })] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0].id).toBe("aaaaaaaa-0000-4000-8000-000000000001");
  });
  it("links no copy whose name or link differs, nor a gift from a list", async () => {
    const near = [copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000a", name: "Le Creuset Dutch Oven" }),
      copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000b", product_link: "https://www.example.com/dutch-oven/" }),
      copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000c", from_list: true })];
    const s = seeded({ claims: [oven()], gifts: near }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven).map((g) => g.id)).not.toEqual(expect.arrayContaining(near.map((g) => g.id)));
    expect(s.writes).toContain("insertGift:Le Creuset Dutch oven");
  });
  it("moves a gift at Claimed to Ordered when its item was marked bought on the site", async () => {   // D7, §5.3
    const s = seeded({ replaceClaims: true, claims: [scarfClaim({}, { purchased: true }), w.claims[1]] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.scarf)[0].status).toBe("ordered");
  });
  it("leaves a gift at Ordered alone when its item is no longer bought", async () => {
    const s = seeded({ replaceClaims: true, claims: [w.claims[0], { ...w.claims[1], item: { ...w.claims[1].item!, purchased: false } }] });
    await reconcileGifts(s, TODAY);
    expect(s.writes).toEqual([]);
  });
  it("brings a gift's occasion into step with its claim's", async () => {                              // D12, §5.3a
    const s = seeded({ replaceClaims: true, claims: [scarfClaim({ occasionId: IDS.momBirthday, occasionDate: "2027-01-14" }), w.claims[1]] });
    await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.scarf)[0]).toMatchObject({ occasion_id: IDS.momBirthday, season_year: 2027 });
  });
  it("leaves a gift at Claimed whose claim is no longer held", async () => {
    const s = seeded({ replaceClaims: true, claims: [w.claims[1]] }); await reconcileGifts(s, TODAY);
    expect([forItem(s, IDS.scarf)[0].status, s.writes]).toEqual(["planned", []]);
  });
  it("skips a claim whose item the caller can no longer see", async () => {
    const s = seeded({ claims: [{ ...oven(), item: null }] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)).toEqual([]);
  });
  it("ignores a lapsed claim", async () => {
    const s = seeded({ claims: [oven({ occasionDate: "2026-11-10" })] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)).toEqual([]);
  });
  it("running it twice changes nothing the second time", async () => {
    const s = seeded({ claims: [oven()] }); await reconcileGifts(s, TODAY);
    const after = s.writes.length; await reconcileGifts(s, TODAY);
    expect(s.writes.length).toBe(after);
  });
  it("never touches another person's gifts", async () => {
    const dads = { ...copyOf(), user_id: "user_2dadABC" };
    const s = memoryGiftStore(SAM, { claims: [oven()], gifts: [dads], recipients: w.recipients.map((r) => ({ ...r, user_id: SAM })) });
    await reconcileGifts(s, TODAY);
    expect(s.allGifts().find((g) => g.user_id === "user_2dadABC")).toEqual(dads);
  });
  it("two reconciles at once file one gift and one recipient", async () => {                           // Review Focus 1
    const s = seeded({ claims: [oven({ owner: w.people.dad }, { ownerId: "user_2dadABC" })] });
    await Promise.all([reconcileGifts(s, TODAY), reconcileGifts(s, TODAY)]);
    expect(forItem(s, IDS.dutchOven)).toHaveLength(1);
    expect(s.allRecipients().filter((r) => r.person_id === "user_2dadABC")).toHaveLength(1);
  });
  it("two reconciles at once file one gift and one recipient when a typed recipient has the person's name", async () => {   // Review Focus 1
    const s = seeded({ claims: [oven({ owner: w.people.dad }, { ownerId: "user_2dadABC" })],
      recipients: [{ id: "bbbbbbbb-0000-4000-8000-000000000001", name: "Dad", person_id: null }] });
    await expect(Promise.all([reconcileGifts(s, TODAY), reconcileGifts(s, TODAY)])).resolves.toBeDefined();
    expect(forItem(s, IDS.dutchOven)).toHaveLength(1);
    expect(s.allRecipients().filter((r) => r.person_id === "user_2dadABC")).toEqual([expect.objectContaining({ name: "Dad (from their list)" })]);
    expect(forItem(s, IDS.dutchOven)[0].recipient_id).toBe(s.allRecipients().find((r) => r.person_id === "user_2dadABC")!.id);
  });
});
describe("fileClaim", () => {
  it("returns the gift already filed for the item, moved to the claim's occasion (Claim again)", async () => {
    const s = seeded({ replaceClaims: true, claims: [] });
    const gift = await fileClaim(s, scarfClaim({ occasionId: IDS.momBirthday, occasionDate: "2027-01-14" }) as ClaimRow & { item: ClaimedItem }, TODAY);
    expect(gift).toMatchObject({ id: IDS.giftScarf, occasion_id: IDS.momBirthday });
    expect(s.writes.filter((x) => x.startsWith("insert"))).toEqual([]);
  });
});
describe("recipientFor", () => {
  it("reuses the recipient already linked to the person", async () => {
    const s = seeded(); expect((await recipientFor(s, w.people.mom)).id).toBe(IDS.recipientMom); expect(s.writes).toEqual([]);
  });
  it("adds ' (from their list)' when a typed recipient has that name, and leaves the typed one alone", async () => {
    const typed = { id: "bbbbbbbb-0000-4000-8000-000000000001", name: "Dad", person_id: null };
    const s = seeded({ recipients: [typed] });
    expect(await recipientFor(s, w.people.dad)).toMatchObject({ name: "Dad (from their list)", person_id: "user_2dadABC" });
    expect(s.allRecipients().find((r) => r.id === typed.id)).toMatchObject({ name: "Dad", person_id: null });
  });
  it("keeps the name within the tracker's 100 characters", async () =>
    expect([...(await recipientFor(seeded(), { ...w.people.dad, display_name: "a".repeat(150) })).name]).toHaveLength(100));
  it("answers the same recipient to two requests at once", async () => {
    const s = seeded(); const [a, b] = await Promise.all([recipientFor(s, w.people.dad), recipientFor(s, w.people.dad)]);
    expect(a.id).toBe(b.id); expect(s.allRecipients().filter((r) => r.person_id === "user_2dadABC")).toHaveLength(1);
  });
});
