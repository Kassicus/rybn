import { describe, it, expect, vi, afterEach } from "vitest";
import type { ClaimRow, ClaimedItem, RecipientRow, StoredGift } from "./gifts";
import type { NewGift } from "./gift-store";
import { memoryGiftStore, type MemoryGiftStore } from "./test-gift-store";
import { oven } from "./test-shopping-mocks";
import { IDS, SAM, TODAY, world } from "./test-shopping";
import { fileClaim, reconcileGifts, recipientFor } from "./reconcile";

const w = world();
type StoreOptions = { failInsertGift?: Error | ((row: NewGift) => Error | undefined); personClashFirst?: boolean };
const seeded = (extra: { claims?: ClaimRow[]; gifts?: StoredGift[]; recipients?: RecipientRow[]; replaceClaims?: boolean } & StoreOptions = {}) =>
  memoryGiftStore(SAM, {
    failInsertGift: extra.failInsertGift, personClashFirst: extra.personClashFirst,
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
  it("links the newest of several qualifying copies", async () => {
    const younger = copyOf({ id: "aaaaaaaa-0000-4000-8000-000000000002", created_at: "2026-10-05T10:00:00.000000+00:00" });
    const s = seeded({ claims: [oven()], gifts: [younger, copyOf()] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven).map((g) => g.id)).toEqual(["aaaaaaaa-0000-4000-8000-000000000002"]);
  });
  it("counts two empty links as equal when the copy is for the item's owner", async () => {
    const s = seeded({ claims: [oven({}, { url: null })], gifts: [copyOf({ product_link: null, recipient_id: IDS.recipientMom })] });
    await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0].id).toBe("aaaaaaaa-0000-4000-8000-000000000001");
  });
  it("with no link on either side, links a copy under a typed recipient named exactly as the owner, and not a differently named one", async () => {
    const typedDad = { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Dad", person_id: null };
    const dadClaim = () => oven({ owner: w.people.dad }, { url: null, ownerId: "user_2dadABC" });
    const s = seeded({ claims: [dadClaim()], recipients: [typedDad], gifts: [copyOf({ product_link: null })] });
    await reconcileGifts(s, TODAY);
    expect(s.writes).toContain("insertGift:Le Creuset Dutch oven");   // Joe's copy is not Dad's
    expect(s.allGifts().find((g) => g.id === "aaaaaaaa-0000-4000-8000-000000000001")!.wishlist_item_id).toBeNull();
    const s2 = seeded({ claims: [dadClaim()], recipients: [typedDad],
      gifts: [copyOf({ product_link: null, recipient_id: typedDad.id })] });
    await reconcileGifts(s2, TODAY);
    expect(s2.writes.filter((x) => x.startsWith("insert"))).toEqual([]);
    expect(forItem(s2, IDS.dutchOven)[0].id).toBe("aaaaaaaa-0000-4000-8000-000000000001");
  });
  it("with a link on the item, links a copy under any typed recipient", async () => {
    const s = seeded({ claims: [oven()], gifts: [copyOf()] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0]).toMatchObject({ id: "aaaaaaaa-0000-4000-8000-000000000001", recipient_id: IDS.recipientJoe });
  });
  it("links no given or archived gift, however well it matches", async () => {
    const card = [copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000d", status: "given", is_archived: true }),
      copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000e", status: "given" }),
      copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000f", is_archived: true })];
    const s = seeded({ claims: [oven()], gifts: card }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven).map((g) => g.id)).not.toContain("aaaaaaaa-0000-4000-8000-00000000000d");
    expect(forItem(s, IDS.dutchOven).filter((g) => card.some((c) => c.id === g.id))).toEqual([]);
    expect(s.writes).toContain("insertGift:Le Creuset Dutch oven");
  });
  it("links no copy under a recipient linked to a different person", async () => {
    const s = seeded({ claims: [oven()], gifts: [copyOf({ recipient_id: IDS.recipientAlex })] }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven).map((g) => g.recipient_id)).toEqual([IDS.recipientMom]);
    expect(s.writes).toContain("insertGift:Le Creuset Dutch oven");
  });
  it("seasons a linked copy by today's year when the claim has no occasion, however old the copy", async () => {
    const s = seeded({ claims: [oven({ occasionId: null, occasionDate: null })], gifts: [copyOf({ created_at: "2025-12-30T10:00:00.000000+00:00" })] });
    await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0]).toMatchObject({ occasion_id: null, season_year: 2026 });
  });
  it("breaks a tie in created_at by id, whichever order the copies come in", async () => {
    const a = copyOf({ id: "aaaaaaaa-0000-4000-8000-000000000002" });
    const b = copyOf({ id: "aaaaaaaa-0000-4000-8000-000000000003" });
    for (const order of [[a, b], [b, a]]) {
      const s = seeded({ claims: [oven()], gifts: order }); await reconcileGifts(s, TODAY);
      expect(forItem(s, IDS.dutchOven).map((g) => g.id)).toEqual([a.id]);
    }
  });
  it("links no copy whose name or link differs, nor a gift from a list", async () => {
    const near = [copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000a", name: "Le Creuset Dutch Oven" }),
      copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000b", product_link: "https://www.example.com/dutch-oven/" }),
      copyOf({ id: "aaaaaaaa-0000-4000-8000-00000000000c", from_list: true })];
    const s = seeded({ claims: [oven()], gifts: near }); await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven).filter((g) => near.some((n) => n.id === g.id))).toEqual([]);
    expect(s.allGifts().filter((g) => near.some((n) => n.id === g.id)).every((g) => g.wishlist_item_id === null)).toBe(true);
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
const dataError = (code: string) => Object.assign(new Error("boom"), { code });
const kindle = () => oven({ itemId: IDS.kindle }, { id: IDS.kindle, title: "Kindle Paperwhite", url: "https://www.example.com/kindle" });
afterEach(() => vi.restoreAllMocks());

describe("one bad claim", () => {
  it("is skipped and logged by item id and code only, while the other claim is filed", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = seeded({ claims: [oven(), kindle()],
      failInsertGift: (row) => (row.wishlist_item_id === IDS.dutchOven ? dataError("23514") : undefined) });
    await expect(reconcileGifts(s, TODAY)).resolves.toBeUndefined();
    expect(forItem(s, IDS.dutchOven)).toEqual([]);
    expect(forItem(s, IDS.kindle)).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    expect(line).toContain(IDS.dutchOven); expect(line).toContain("23514");
    expect(line).not.toContain("Le Creuset"); expect(line).not.toContain("Mom");
  });
  it("is skipped when both of the person's recipient names are taken", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const typed = [{ id: "bbbbbbbb-0000-4000-8000-000000000001", name: "Dad", person_id: null },
      { id: "bbbbbbbb-0000-4000-8000-000000000002", name: "Dad (from their list)", person_id: null }];
    const s = seeded({ claims: [oven({ owner: w.people.dad }, { ownerId: "user_2dadABC" }), kindle()], recipients: typed });
    await expect(reconcileGifts(s, TODAY)).resolves.toBeUndefined();
    expect(forItem(s, IDS.dutchOven)).toEqual([]);
    expect(forItem(s, IDS.kindle)).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(1);
  });
  it("still throws when the failure has no data code", async () => {
    const s = seeded({ claims: [oven()], failInsertGift: new Error("connection reset") });
    await expect(reconcileGifts(s, TODAY)).rejects.toThrow("connection reset");
    const s2 = seeded({ claims: [oven()], failInsertGift: dataError("08006") });
    await expect(reconcileGifts(s2, TODAY)).rejects.toThrow("boom");
  });
  it("is filed with an over-long description cut to the column's 1000, a title to 200, and a negative price as none", async () => {
    const s = seeded({ claims: [oven({}, { description: "é".repeat(1500), title: "T".repeat(250), price: -5 })] });
    await reconcileGifts(s, TODAY);
    const g = s.allGifts().find((x) => x.wishlist_item_id === IDS.dutchOven)!;
    expect(Array.from(g.description!)).toHaveLength(1000);
    expect(Array.from(g.name)).toHaveLength(200);
    expect(g.price).toBeNull();
  });
  it("cuts a description of astral characters to exactly 1000 code points without splitting one", async () => {
    const s = seeded({ claims: [oven({}, { description: "\u{1F600}".repeat(1500) })] });
    await reconcileGifts(s, TODAY);
    expect(forItem(s, IDS.dutchOven)[0].description).toBe("\u{1F600}".repeat(1000));
  });
});
describe("a gift or copy deleted at the same instant", () => {
  it("is filed afresh when the copy goes away as it is linked", async () => {
    const s = seeded({ claims: [oven()], gifts: [copyOf()] });
    const store = { ...s, updateGift: async (id: string) => { await s.deleteGift(id); return null; } };
    await reconcileGifts(store, TODAY);
    expect(forItem(s, IDS.dutchOven)).toEqual([expect.objectContaining({ recipient_id: IDS.recipientMom })]);
  });
  it("is filed afresh when the item's gift goes away as it is moved", async () => {
    const s = seeded({ replaceClaims: true, claims: [] });
    const store = { ...s, updateGift: async (id: string) => { await s.deleteGift(id); return null; } };
    const gift = await fileClaim(store, scarfClaim({ occasionId: IDS.momBirthday, occasionDate: "2027-01-14" }) as ClaimRow & { item: ClaimedItem }, TODAY);
    expect(gift.id).not.toBe(IDS.giftScarf);
    expect(forItem(s, IDS.scarf)).toEqual([expect.objectContaining({ id: gift.id, occasion_id: IDS.momBirthday })]);
  });
});
describe("a failed update of an existing gift", () => {
  const moved = () => [scarfClaim({ occasionId: IDS.momBirthday, occasionDate: "2027-01-14" }),
    { ...w.claims[1], occasionId: IDS.momBirthday, occasionDate: "2027-01-14" }];
  const failing = (s: MemoryGiftStore, error: Error) => ({ ...s,
    updateGift: (id: string, patch: Parameters<MemoryGiftStore["updateGift"]>[1]) => id === IDS.giftScarf ? Promise.reject(error) : s.updateGift(id, patch) });
  it("is skipped and logged by item id and code when the failure is the claim's data, and the next claim still moves", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const s = seeded({ replaceClaims: true, claims: moved() });
    await expect(reconcileGifts(failing(s, dataError("23503")), TODAY)).resolves.toBeUndefined();
    expect(forItem(s, IDS.scarf)[0].occasion_id).toBe(IDS.xmas);
    expect(forItem(s, IDS.catan)[0].occasion_id).toBe(IDS.momBirthday);
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toContain(IDS.scarf); expect(String(log.mock.calls[0][0])).toContain("23503");
  });
  it("still throws when the failure has no data code", async () => {
    const s = seeded({ replaceClaims: true, claims: moved() });
    await expect(reconcileGifts(failing(s, new Error("connection reset")), TODAY)).rejects.toThrow("connection reset");
  });
});
describe("fileClaim", () => {
  it("gives a linked copy and a claim made again the same season", async () => {
    const s = seeded({ gifts: [copyOf({ created_at: "2025-12-30T10:00:00.000000+00:00" })] });
    const claim = oven({ occasionId: null, occasionDate: null });
    expect(await fileClaim(s, claim, TODAY)).toMatchObject({ id: "aaaaaaaa-0000-4000-8000-000000000001", occasion_id: null, season_year: 2026 });
    const after = s.writes.length; await fileClaim(s, claim, TODAY);
    expect(s.writes.length).toBe(after);
  });
  it("moves a claim made again in a later year into this year's season, and a second run writes nothing", async () => {
    const stale = { ...w.gifts.find((g) => g.id === IDS.giftScarf)!, season_year: 2025 };
    const t = memoryGiftStore(SAM, { gifts: [{ ...stale, user_id: SAM }], recipients: w.recipients.map((r) => ({ ...r, user_id: SAM })) });
    const claim = scarfClaim({}) as ClaimRow & { item: ClaimedItem };
    expect(await fileClaim(t, claim, TODAY)).toMatchObject({ id: IDS.giftScarf, occasion_id: IDS.xmas, season_year: 2026 });
    const after = t.writes.length; await fileClaim(t, claim, TODAY);
    expect(t.writes.length).toBe(after);
  });
  it("answers the same gift to two calls at once, filing it afresh", async () => {
    const s = seeded();
    const [a, b] = await Promise.all([fileClaim(s, oven(), TODAY), fileClaim(s, oven(), TODAY)]);
    expect(a.id).toBe(b.id); expect(forItem(s, IDS.dutchOven)).toHaveLength(1);
  });
  it("answers the same gift to two calls at once, linking a copy", async () => {
    const s = seeded({ gifts: [copyOf()] });
    const [a, b] = await Promise.all([fileClaim(s, oven(), TODAY), fileClaim(s, oven(), TODAY)]);
    expect(a.id).toBe(b.id); expect(a.id).toBe("aaaaaaaa-0000-4000-8000-000000000001"); expect(forItem(s, IDS.dutchOven)).toHaveLength(1);
  });
  it("returns the gift already filed for the item, moved to the claim's occasion (Claim again)", async () => {
    const s = seeded({ replaceClaims: true, claims: [] });
    const gift = await fileClaim(s, scarfClaim({ occasionId: IDS.momBirthday, occasionDate: "2027-01-14" }) as ClaimRow & { item: ClaimedItem }, TODAY);
    expect(gift).toMatchObject({ id: IDS.giftScarf, occasion_id: IDS.momBirthday });
    expect(s.writes.filter((x) => x.startsWith("insert"))).toEqual([]);
  });
});
describe("recipientFor", () => {
  it("copes when the person index reports first (two requests at once, a typed recipient with the name)", async () => {
    const typed = { id: "bbbbbbbb-0000-4000-8000-000000000001", name: "Dad", person_id: null };
    const s = seeded({ recipients: [typed], personClashFirst: true });
    const [a, b] = await Promise.all([recipientFor(s, w.people.dad), recipientFor(s, w.people.dad)]);
    expect(a.id).toBe(b.id);
    expect(s.allRecipients().filter((r) => r.person_id === "user_2dadABC")).toEqual([expect.objectContaining({ name: "Dad (from their list)" })]);
  });
  it("copes when the person index reports first (two requests at once, no typed recipient)", async () => {
    const s = seeded({ personClashFirst: true });
    const [a, b] = await Promise.all([recipientFor(s, w.people.dad), recipientFor(s, w.people.dad)]);
    expect(a.id).toBe(b.id); expect(s.allRecipients().filter((r) => r.person_id === "user_2dadABC")).toHaveLength(1);
  });
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
