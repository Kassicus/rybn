// Tests only. A GiftStore that behaves as the database would, including its two unique indexes.
import type { GiftStatus } from "@/lib/schemas/gift-tracking";
import type { ClaimRow, RecipientRow, StoredGift } from "./gifts";
import type { GiftPatch, GiftStore, NewGift } from "./gift-store";

type OwnedGift = StoredGift & { user_id: string };
type OwnedRecipient = RecipientRow & { user_id: string };

export type MemoryGiftStore = GiftStore & {
  allGifts(): OwnedGift[];
  allRecipients(): OwnedRecipient[];
  addClaim(claim: ClaimRow): void;
  writes: string[];
};

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export function memoryGiftStore(
  userId: string,
  seed: { claims?: ClaimRow[]; gifts?: OwnedGift[]; recipients?: OwnedRecipient[]; failInsertGift?: Error | ((row: NewGift) => Error | undefined); personClashFirst?: boolean } = {},
): MemoryGiftStore {
  const claims: ClaimRow[] = [...(seed.claims ?? [])];
  const gifts: OwnedGift[] = (seed.gifts ?? []).map((g) => ({ ...g }));
  const recipients: OwnedRecipient[] = (seed.recipients ?? []).map((r) => ({ ...r }));
  const writes: string[] = [];
  const mine = <T extends { user_id: string }>(rows: T[]) => rows.filter((r) => r.user_id === userId);
  const strip = (g: OwnedGift): StoredGift => {
    const rest: Partial<OwnedGift> = { ...g };
    delete rest.user_id;
    return rest as StoredGift;
  };
  const stripRecipient = (r: OwnedRecipient): RecipientRow => ({ id: r.id, name: r.name, person_id: r.person_id });

  return {
    writes,
    allGifts: () => gifts.map((g) => ({ ...g })),
    allRecipients: () => recipients.map((r) => ({ ...r })),
    addClaim: (claim) => void claims.push(claim),
    async activeClaims() {
      await tick();
      return claims.map((c) => ({ ...c }));
    },
    async gifts() {
      await tick();
      return mine(gifts)
        .slice()
        .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))
        .map(strip);
    },
    async recipients() {
      await tick();
      return mine(recipients).map(stripRecipient);
    },
    async insertRecipient(row) {
      await tick();
      const nameClash = mine(recipients).some((r) => r.name === row.name);
      const personClash = row.person_id !== null && mine(recipients).some((r) => r.person_id === row.person_id);
      // The database reports the name index first (observed on the scratch database); personClashFirst makes it report the other.
      if (seed.personClashFirst && personClash) return { ok: false, clash: "person" };
      if (nameClash) return { ok: false, clash: "name" };
      if (personClash) return { ok: false, clash: "person" };
      const made: OwnedRecipient = { id: crypto.randomUUID(), user_id: userId, name: row.name, person_id: row.person_id };
      recipients.push(made);
      writes.push(`insertRecipient:${row.name}`);
      return { ok: true, row: stripRecipient(made) };
    },
    async insertGift(row: NewGift) {
      await tick();
      const failure = typeof seed.failInsertGift === "function" ? seed.failInsertGift(row) : seed.failInsertGift;
      if (failure) throw failure;
      if (row.wishlist_item_id !== null && mine(gifts).some((g) => g.wishlist_item_id === row.wishlist_item_id)) {
        return { ok: false, clash: "item" };
      }
      const now = new Date().toISOString();
      const made: OwnedGift = { ...row, id: crypto.randomUUID(), user_id: userId, is_archived: false, created_at: now, updated_at: now };
      gifts.push(made);
      writes.push(`insertGift:${row.name}`);
      return { ok: true, row: strip(made) };
    },
    async updateGift(id: string, patch: GiftPatch, expect?: { status: GiftStatus }) {
      await tick();
      const g = mine(gifts).find((x) => x.id === id);
      if (!g) return null;
      if (expect && g.status !== expect.status) return null;
      if (
        patch.wishlist_item_id !== undefined &&
        patch.wishlist_item_id !== null &&
        mine(gifts).some((x) => x.id !== id && x.wishlist_item_id === patch.wishlist_item_id)
      ) {
        return { ok: false, clash: "item" };
      }
      Object.assign(g, patch, { updated_at: new Date().toISOString() });
      writes.push(`updateGift:${id}`);
      return { ok: true, row: strip(g) };
    },
    async deleteGift(id, expect) {
      await tick();
      const i = gifts.findIndex((x) => x.id === id && x.user_id === userId);
      if (i >= 0 && expect && gifts[i].status !== expect.status) return;
      if (i >= 0) gifts.splice(i, 1);
      writes.push(`deleteGift:${id}`);
    },
  };
}
