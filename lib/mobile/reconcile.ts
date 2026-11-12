import { isExternalImageUrl, imageValueProblem } from "@/lib/storage/image-value";
import type { GiftPatch, GiftStore } from "./gift-store";
import {
  filedGiftValues,
  giftSeason,
  heldItemIds,
  recipientNameChoices,
  recipientNames,
  type ClaimRow,
  type ClaimedItem,
  type RecipientRow,
  type StoredGift,
} from "./gifts";
import { mobilePerson, type PersonRow } from "./occasions";

type HeldClaim = ClaimRow & { item: ClaimedItem };

/**
 * Before any route shows gifts: file each claim the caller holds as a tracked gift (D8), link a hand-made copy
 * (D15), move a gift on when its item was bought (D7), and keep its occasion in step with the claim's (D12).
 * Safe to run twice at once and to run again: the unique indexes are the backstop.
 */
export async function reconcileGifts(store: GiftStore, today: string): Promise<void> {
  const claims = await store.activeClaims();
  const held = heldItemIds(claims, today);
  const gifts = await store.gifts();
  for (const c of claims) {
    if (c.item === null || !held.has(c.itemId)) continue;
    const claim = c as HeldClaim;
    const g = gifts.find((x) => x.wishlist_item_id === claim.itemId);
    if (!g) {
      try {
        gifts.push(await fileClaim(store, claim));
      } catch (e) {
        if (!isClaimDataError(e)) throw e;
        // One claim's own data (a value the table refuses): skip it so the rest still show. Id and code only.
        console.error(`reconcileGifts: skipped item ${claim.itemId}: ${e.code}`);
      }
      continue;
    }
    const patch: GiftPatch = {};
    if (g.status === "planned" && claim.item.purchased) patch.status = "ordered";
    if (g.occasion_id !== claim.occasionId) {
      patch.occasion_id = claim.occasionId;
      patch.season_year = giftSeason(claim.occasionDate, g.created_at);
    }
    if (Object.keys(patch).length === 0) continue;
    try {
      await store.updateGift(g.id, patch);
    } catch (e) {
      if (!isClaimDataError(e)) throw e;
      console.error(`reconcileGifts: skipped item ${claim.itemId}: ${e.code}`);
    }
  }
}

/** Newest first; the same created_at is told apart by id so every request picks the same gift. */
const newestFirst = (a: StoredGift, b: StoredGift) =>
  a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Carried by the error recipientFor throws when every name is taken, so reconcileGifts can tell it from a fault. */
export const NAMES_TAKEN = "rybn:names-taken";

/** Whether a failure is down to one claim's own data: SQLSTATE class 22 or 23, or every recipient name taken. */
export function isClaimDataError(e: unknown): e is Error & { code: string } {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" && (code === NAMES_TAKEN || /^2[23]/.test(code));
}

/** D15: the hand-made gift a claim may take over, or undefined. The newest that qualifies. */
function handMadeCopy(gifts: StoredGift[], recipients: RecipientRow[], claim: HeldClaim): StoredGift | undefined {
  const ownerId = claim.item.ownerId;
  const ownerName = claim.owner ? recipientNames(mobilePerson(claim.owner).name).plain : null;
  const itemLink = claim.item.url ?? "";
  return gifts
    .filter((g) => {
      if (g.wishlist_item_id !== null || g.from_list || g.is_archived || g.status === "given") return false;
      if (g.name !== claim.item.title) return false;
      const recipient = recipients.find((r) => r.id === g.recipient_id);
      const personId = recipient?.person_id ?? null;
      if (personId !== null && personId !== ownerId) return false;
      if (itemLink !== "") return g.product_link === itemLink;
      if ((g.product_link ?? "") !== "") return false;
      return personId === ownerId || (recipient !== undefined && personId === null && ownerName !== null && recipient.name === ownerName);
    })
    .sort(newestFirst)[0];
}

/**
 * The caller's gift for a held claim: the one already filed for the item, a hand-made copy linked, or a new one. Its
 * season is the occasion's year, or for a claim with no occasion the year the claim was made: so filing it again, or
 * first filing an old site claim, never moves it to the year it happens to be filed in.
 */
export async function fileClaim(store: GiftStore, claim: HeldClaim): Promise<StoredGift> {
  let gifts = await store.gifts();
  const status = claim.item.purchased ? "ordered" : "planned";
  const season = giftSeason(claim.occasionDate, claim.claimedAt);
  const byItem = (rows: StoredGift[]) => rows.find((g) => g.wishlist_item_id === claim.itemId);

  const existing = byItem(gifts);
  if (existing) {
    const patch: GiftPatch = {};
    if (existing.occasion_id !== claim.occasionId) patch.occasion_id = claim.occasionId;
    if (existing.occasion_id !== claim.occasionId || existing.season_year !== season) patch.season_year = season;
    if (existing.status === "planned" && claim.item.purchased) patch.status = "ordered";
    if (Object.keys(patch).length === 0) return existing;
    const updated = await store.updateGift(existing.id, patch);
    if (updated !== null && updated.ok) return updated.row;
    // Gone, or filed twice by a request alongside: look again, and file afresh if it is not there.
    gifts = await store.gifts();
    const again = byItem(gifts);
    if (again) return again;
  }

  const copy = handMadeCopy(gifts, await store.recipients(), claim);
  if (copy) {
    const linked = await store.updateGift(copy.id, {
      wishlist_item_id: claim.itemId,
      from_list: true,
      occasion_id: claim.occasionId,
      season_year: season,
      status: copy.status === "planned" && claim.item.purchased ? "ordered" : copy.status,
    });
    if (linked !== null && linked.ok) return linked.row;
    const again = byItem(await store.gifts());
    if (again) return again;
    // The copy went away under us: file afresh.
  }

  const image = claim.item.imageValue;
  // Fitted to the door's rules as well as the table's: tracked_gifts checks a name of 1–200 and a description of at
  // most 1000 characters (code points), and a price that is null or at least 0.
  const fitted = filedGiftValues(claim.item);
  for (let attempt = 0; attempt < 3; attempt++) {
    const recipient = await recipientFor(
      store,
      claim.owner ?? { id: claim.item.ownerId, username: null, display_name: null, avatar_url: null },
    );
    const r = await store.insertGift({
      recipient_id: recipient.id,
      name: fitted.name,
      description: fitted.description,
      photo_url: isExternalImageUrl(image) && imageValueProblem(image) === null ? image : null,
      product_link: fitted.link,
      price: fitted.price,
      status,
      wishlist_item_id: claim.itemId,
      from_list: true,
      occasion_id: claim.occasionId,
      season_year: season,
      notes: null,
    });
    if (r.ok) return r.row;
    // A clash on the item: another request filed it first.
    const filed = byItem(await store.gifts());
    if (filed) return filed;
  }
  throw new Error(`fileClaim: no gift for item ${claim.itemId} after filing it`);
}

export async function recipientFor(store: GiftStore, person: PersonRow): Promise<RecipientRow> {
  const linked = (rows: RecipientRow[]) => rows.find((r) => r.person_id === person.id);
  const already = linked(await store.recipients());
  if (already) return already;

  for (const name of recipientNameChoices(mobilePerson(person).name)) {
    const r = await store.insertRecipient({ name, person_id: person.id });
    if (r.ok) return r.row;
    const found = linked(await store.recipients());
    if (r.clash === "person") {
      if (found) return found;
      throw new Error(`recipientFor: the person index reported a clash but no recipient is linked to ${person.id}`);
    }
    // clash "name": a request alongside made it (and the name index reported first), or another recipient (typed, or
    // for someone showing the same name) has the name. Try the next.
    if (found) return found;
  }
  throw Object.assign(new Error(`recipientFor: every name is taken for ${person.id}`), { code: NAMES_TAKEN });
}
