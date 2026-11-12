import { releaseClaim } from "@/lib/actions/claims";
import { getWishlistItem } from "@/lib/actions/wishlist";
import { todayISO } from "@/lib/claims/active";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { createClient } from "@/lib/supabase/server";
import { NOT_SIGNED_IN } from "./action-response";
import { NOT_SIGNED_IN_CODE, REFUSED, pathUuid } from "./database";
import { createGiftStore } from "./gift-store-live";
import { loadGiftViews } from "./gift-views-live";
import { heldItemIds, type MobileGift, type StoredGift } from "./gifts";
import { occasionKey } from "./occasions";
import { occasionsForPerson, profiles } from "./people-live";
import { fileClaim } from "./reconcile";
import { mobileError } from "./route";
import { SHOPPING_RULES } from "./shopping-rules";
import { claimRefusal, parseClaimBody } from "./shopping";

/**
 * The row id for an occasion key among `allowed`: a group date's own id; a birthday's or anniversary's id, made through
 * get_or_create_celebrated_occasion when it has none yet (§5.2 step 2). The 422 to send when the key is not among them
 * or the database refuses it (22023); the 401 when the database finds nobody signed in (28000). Any other database
 * error throws.
 */
export async function resolveOccasionId(
  key: string,
  allowed: UpcomingOccasion[],
): Promise<Response | { occasionId: string; occasionDate: string }> {
  const refused = () => mobileError("invalid", SHOPPING_RULES.chooseOccasion);
  const occasion = allowed.find((o) => occasionKey(o) === key);
  if (!occasion) return refused();
  if (occasion.occasionId !== null) return { occasionId: occasion.occasionId, occasionDate: occasion.occasionDate };
  // A group date always has its row; a birthday or anniversary without one is made for its celebrant.
  if (occasion.kind === "group_date" || occasion.celebrantId === null) return refused();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_or_create_celebrated_occasion", {
    p_celebrant_id: occasion.celebrantId,
    p_kind: occasion.kind,
  });
  if (error) {
    if (error.code === NOT_SIGNED_IN_CODE) return mobileError("unauthorized");
    if (error.code === REFUSED) return refused();
    throw new Error(`get_or_create_celebrated_occasion failed: ${error.code ?? ""} ${error.message}`);
  }
  if (typeof data !== "string") throw new Error("get_or_create_celebrated_occasion answered no id");
  return { occasionId: data, occasionDate: occasion.occasionDate };
}

/** What getWishlistItem answers for a visible item, in the columns this file reads. */
interface ItemRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  url: string | null;
  price: number | null;
  image_path?: string | null;
  purchased?: boolean | null;
}

type Found = { item: ItemRow } | { response: Response } | { missing: true };

/** The item as the caller may see it. Signed out: the 401; gone or hidden: missing; any other failure throws. */
async function findItem(itemId: string): Promise<Found> {
  const result = await getWishlistItem(itemId);
  if ("error" in result && result.error) {
    if (result.error === NOT_SIGNED_IN) return { response: mobileError("unauthorized") };
    if ("notFound" in result && result.notFound) return { missing: true };
    throw new Error(`getWishlistItem failed: ${result.error}`);
  }
  return { item: (result as { data: ItemRow }).data };
}

export async function claimAnswer(userId: string, rawItemId: string, raw: unknown): Promise<Response | { gift: MobileGift }> {
  const parsed = parseClaimBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const itemId = pathUuid(rawItemId);
  if (itemId === null) return mobileError("not_found");

  const found = await findItem(itemId);
  if ("response" in found) return found.response;
  if ("missing" in found) return mobileError("not_found");
  const data = found.item;
  // The owner is whoever the database says owns the item, never anyone the request names.
  const owner = data.user_id;
  if (owner === userId) return mobileError("invalid", SHOPPING_RULES.ownItem);

  const today = todayISO();
  // The store is made before the claim is asked for: once the claim stands, nothing may throw outside the try below.
  const store = await createGiftStore(userId);
  const fileFor = async (occasionId: string | null, occasionDate: string | null, claimedAt: string): Promise<StoredGift> =>
    fileClaim(
      store,
      {
        itemId,
        occasionId,
        occasionDate,
        claimedAt,
        owner: (await profiles([owner])).get(owner) ?? null,
        item: {
          id: itemId,
          ownerId: owner,
          title: data.title,
          description: data.description,
          url: data.url,
          price: data.price,
          imageValue: data.image_path ?? null,
          purchased: data.purchased ?? false,
        },
      },
    );
  const answer = async (giftId: string) => {
    const view = (await loadGiftViews(userId, store, today)).find((v) => v.gift.id === giftId);
    if (!view) throw new Error(`claimAnswer: gift ${giftId} is not among the caller's gifts`);
    return { gift: view.gift };
  };

  // A retry by the claim's own holder (a lost answer, or a gift that was never filed): the claim stands as it is,
  // with its own occasion and date, and only its gift is filed. The database is not asked again.
  const mine = (await store.activeClaims()).find((c) => c.itemId === itemId && heldItemIds([c], today).has(itemId));
  if (mine) return answer((await fileFor(mine.occasionId, mine.occasionDate, mine.claimedAt)).id);

  let occasionId: string | null = null;
  let occasionDate: string | null = null;
  if (parsed.body.occasion !== null) {
    const allowed = await occasionsForPerson(owner);
    if (allowed instanceof Response) return allowed;
    const resolved = await resolveOccasionId(parsed.body.occasion, allowed);
    if (resolved instanceof Response) return resolved;
    occasionId = resolved.occasionId;
    occasionDate = resolved.occasionDate;
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_wishlist_item", { p_item_id: itemId, p_occasion_id: occasionId });
  if (error) {
    if (error.code === NOT_SIGNED_IN_CODE) return mobileError("unauthorized");
    if (error.code === REFUSED) return mobileError("invalid", claimRefusal(error.message));
    throw new Error(`claim_wishlist_item failed: ${error.code ?? ""} ${error.message}`);
  }

  // From here the claim stands. It must never stand without its gift. It was made just now, within this request.
  let giftId: string;
  try {
    giftId = (await fileFor(occasionId, occasionDate, today)).id;
  } catch (filing) {
    await giveUpClaim(itemId);
    throw filing;
  }
  return answer(giftId);
}

/** Best effort, for a claim whose gift could not be made. A failure here is logged and never hides the first error. */
async function giveUpClaim(itemId: string): Promise<void> {
  try {
    const released = await releaseClaim(itemId);
    if ("error" in released) console.error(`claimAnswer: releasing item ${itemId} after a failed gift also failed:`, released.error);
  } catch (releasing) {
    console.error(`claimAnswer: releasing item ${itemId} after a failed gift also failed:`, releasing);
  }
}

export async function releaseAnswer(userId: string, rawItemId: string): Promise<Response | null> {
  const itemId = pathUuid(rawItemId);
  if (itemId === null) return null;

  const found = await findItem(itemId);
  if ("response" in found) return found.response;
  // §5.5: the caller's own item is nobody's to release, and nothing about it is read (its purchased is only blank for
  // its owner because getWishlistItem blanks it).
  if ("item" in found && found.item.user_id === userId) return null;
  // D7: once the item is marked bought the claim stays. An item that is gone or hidden has nothing to say about it.
  if ("item" in found && found.item.purchased === true) return mobileError("invalid", SHOPPING_RULES.releaseBought);

  const store = await createGiftStore(userId);
  const gift = (await store.gifts()).find((g) => g.wishlist_item_id === itemId);
  if (gift && gift.status !== "planned") return mobileError("invalid", SHOPPING_RULES.releaseStepBack);

  const released = await releaseClaim(itemId);
  if ("error" in released) {
    if (released.error === NOT_SIGNED_IN) return mobileError("unauthorized");
    throw new Error(`releaseClaim failed: ${released.error}`);
  }
  // A step may have landed since the first read: remove the gift only while it is still at Claimed, at the moment of
  // the delete itself.
  const now = (await store.gifts()).find((g) => g.wishlist_item_id === itemId);
  if (now && now.status === "planned") await store.deleteGift(now.id, { status: "planned" });
  return null;
}
