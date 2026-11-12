import { createWishlistItem, deleteWishlistItem, getMyWishlist, getWishlistItem, updateWishlistItem } from "@/lib/actions/wishlist";
import { getMyGroups } from "@/lib/actions/groups";
import { resolveStoredImageValue } from "@/lib/storage/image-value";
import { NOT_SIGNED_IN, databaseFailure } from "./action-response";
import { pathUuid } from "./database";
import { mobileError } from "./route";
import {
  RULES,
  formDataFromBody,
  isOneOfMyGroups,
  mobileGroups,
  mobileItem,
  parseWishlistBody,
  type GroupRow,
  type MobileGroup,
  type MobileItem,
  type WishlistBody,
  type WishlistItemRow,
} from "./wishlist";

/** The groups the caller belongs to, or the Response to send instead. */
async function loadGroups(): Promise<Response | MobileGroup[]> {
  const result = await getMyGroups();
  const failure = databaseFailure(result, "getMyGroups");
  if (failure) return failure;
  return mobileGroups(result.data as GroupRow[]);
}

/** The three checks a write must pass before the website's action is called. */
async function checkedBody(
  userId: string,
  raw: unknown,
): Promise<Response | { body: WishlistBody; groups: MobileGroup[] }> {
  const parsed = parseWishlistBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const { body } = parsed;

  const image = resolveStoredImageValue(body.imagePath, userId);
  if (!image.ok) return mobileError("invalid", image.error);

  let groups: MobileGroup[] = [];
  if (body.privacy.kind === "group") {
    const loaded = await loadGroups();
    if (loaded instanceof Response) return loaded;
    groups = loaded;
    if (!isOneOfMyGroups(body.privacy, groups)) return mobileError("invalid", RULES.chooseGroup);
  }
  return { body, groups };
}

/**
 * The caller's own item, or what to answer instead. Someone else's item looks the same as one that is gone. Found, it
 * carries the item's id lower-cased, the one every later call uses.
 */
async function findMine(
  userId: string,
  rawItemId: string,
  whenMissing: Response | null,
): Promise<{ found: true; itemId: string } | { found: false; response: Response | null }> {
  // An id that is not a UUID can match nothing, and sent to the database it would only make it error.
  const itemId = pathUuid(rawItemId);
  if (itemId === null) return { found: false, response: whenMissing };
  const result = await getWishlistItem(itemId);
  if ("error" in result && result.error) {
    if (result.error === NOT_SIGNED_IN) return { found: false, response: mobileError("unauthorized") };
    if (result.notFound) return { found: false, response: whenMissing };
    throw new Error(`getWishlistItem failed: ${result.error}`);
  }
  if (!("data" in result) || !result.data || result.data.user_id !== userId) {
    return { found: false, response: whenMissing };
  }
  return { found: true, itemId };
}

export async function listWishlist(): Promise<Response | { items: MobileItem[] }> {
  const [list, groupResult] = await Promise.all([getMyWishlist(), getMyGroups()]);
  const failure = databaseFailure(list, "getMyWishlist");
  if (failure) return failure;
  // The groups only name a group in privacySummary, so the list survives losing them.
  let groups: MobileGroup[] = [];
  if ("error" in groupResult && groupResult.error) {
    if (groupResult.error === NOT_SIGNED_IN) return mobileError("unauthorized");
    console.error("[mobile] wishlist: groups unavailable:", groupResult.error);
  } else {
    groups = mobileGroups(groupResult.data as GroupRow[]);
  }
  const rows = ("data" in list ? list.data : []) as WishlistItemRow[];
  return { items: rows.map((row) => mobileItem(row, groups)) };
}

export async function addWishlistItem(userId: string, raw: unknown): Promise<Response | { item: MobileItem }> {
  const checked = await checkedBody(userId, raw);
  if (checked instanceof Response) return checked;
  const result = await createWishlistItem(formDataFromBody(checked.body));
  const failure = databaseFailure(result, "createWishlistItem");
  if (failure) return failure;
  return { item: mobileItem((result as { data: WishlistItemRow }).data, checked.groups) };
}

export async function replaceWishlistItem(
  userId: string,
  itemId: string,
  raw: unknown,
): Promise<Response | { item: MobileItem }> {
  const checked = await checkedBody(userId, raw);
  if (checked instanceof Response) return checked;
  const lookup = await findMine(userId, itemId, mobileError("not_found"));
  if (!lookup.found) return lookup.response ?? mobileError("not_found");
  const result = await updateWishlistItem(lookup.itemId, formDataFromBody(checked.body));
  if ("error" in result && result.error && result.error !== NOT_SIGNED_IN) {
    // The update may have failed because the item was deleted since the lookup.
    const again = await findMine(userId, lookup.itemId, mobileError("not_found"));
    if (!again.found) return again.response ?? mobileError("not_found");
  }
  const failure = databaseFailure(result, "updateWishlistItem");
  if (failure) return failure;
  return { item: mobileItem((result as { data: WishlistItemRow }).data, checked.groups) };
}

/** Deleting what is not there, or not yours, answers like deleting your own: nothing to report. */
export async function removeWishlistItem(userId: string, itemId: string): Promise<Response | null> {
  const lookup = await findMine(userId, itemId, null);
  if (!lookup.found) return lookup.response;
  const result = await deleteWishlistItem(lookup.itemId);
  return databaseFailure(result, "deleteWishlistItem");
}
