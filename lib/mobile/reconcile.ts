import { isExternalImageUrl, imageValueProblem } from "@/lib/storage/image-value";
import type { GiftStore } from "./gift-store";
import { giftSeason, heldItemIds, recipientNames, type ClaimRow, type ClaimedItem, type RecipientRow, type StoredGift } from "./gifts";
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
      gifts.push(await fileClaim(store, claim, today));
      continue;
    }
    const patch: { status?: StoredGift["status"]; occasion_id?: string | null; season_year?: number } = {};
    if (g.status === "planned" && claim.item.purchased) patch.status = "ordered";
    if (g.occasion_id !== claim.occasionId) {
      patch.occasion_id = claim.occasionId;
      patch.season_year = giftSeason(claim.occasionDate, g.created_at);
    }
    if (Object.keys(patch).length > 0) await store.updateGift(g.id, patch);
  }
}

export async function fileClaim(store: GiftStore, claim: HeldClaim, today: string): Promise<StoredGift> {
  const gifts = await store.gifts();
  const status = claim.item.purchased ? "ordered" : "planned";
  const season = giftSeason(claim.occasionDate, today);
  const byItem = (rows: StoredGift[]) => rows.find((g) => g.wishlist_item_id === claim.itemId);

  const existing = byItem(gifts);
  if (existing) {
    const patch: { status?: StoredGift["status"]; occasion_id?: string | null; season_year?: number } = {};
    if (existing.occasion_id !== claim.occasionId) {
      patch.occasion_id = claim.occasionId;
      patch.season_year = season;
    }
    if (existing.status === "planned" && claim.item.purchased) patch.status = "ordered";
    if (Object.keys(patch).length === 0) return existing;
    const updated = await store.updateGift(existing.id, patch);
    return updated !== null && updated.ok ? updated.row : (byItem(await store.gifts()) ?? existing);
  }

  const copy = gifts
    .filter(
      (g) =>
        g.wishlist_item_id === null &&
        !g.from_list &&
        g.name === claim.item.title &&
        (g.product_link ?? "") === (claim.item.url ?? ""),
    )
    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0))[0];

  let r;
  if (copy) {
    r = await store.updateGift(copy.id, {
      wishlist_item_id: claim.itemId,
      from_list: true,
      occasion_id: claim.occasionId,
      season_year: season,
      status: copy.status === "planned" && claim.item.purchased ? "ordered" : copy.status,
    });
  } else {
    const recipient = await recipientFor(
      store,
      claim.owner ?? { id: claim.item.ownerId, username: null, display_name: null, avatar_url: null },
    );
    const image = claim.item.imageValue;
    r = await store.insertGift({
      recipient_id: recipient.id,
      name: claim.item.title,
      description: claim.item.description,
      photo_url: isExternalImageUrl(image) && imageValueProblem(image) === null ? image : null,
      product_link: claim.item.url,
      price: claim.item.price,
      status,
      wishlist_item_id: claim.itemId,
      from_list: true,
      occasion_id: claim.occasionId,
      season_year: season,
      notes: null,
    });
  }

  if (r !== null && r.ok) return r.row;
  // A clash on the item: another request filed it first. (null: the copy went away under us; look again.)
  const filed = byItem(await store.gifts());
  if (!filed) throw new Error(`fileClaim: no gift for item ${claim.itemId} after filing it`);
  return filed;
}

export async function recipientFor(store: GiftStore, person: PersonRow): Promise<RecipientRow> {
  const linked = (rows: RecipientRow[]) => rows.find((r) => r.person_id === person.id);
  const already = linked(await store.recipients());
  if (already) return already;

  const { plain, fromList } = recipientNames(mobilePerson(person).name);
  for (const name of [plain, fromList]) {
    const r = await store.insertRecipient({ name, person_id: person.id });
    if (r.ok) return r.row;
    const found = linked(await store.recipients());
    if (r.clash === "person") {
      if (found) return found;
      throw new Error(`recipientFor: the person index reported a clash but no recipient is linked to ${person.id}`);
    }
    // clash "name": a request alongside made it (and the name index reported first), or a typed recipient has the name.
    if (found) return found;
  }
  throw new Error(`recipientFor: both names are taken for ${person.id}`);
}
