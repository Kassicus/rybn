import { createWishlistItem, deleteWishlistItem, getMyWishlist, getWishlistItem, updateWishlistItem } from "@/lib/actions/wishlist";
import { getMyGroups } from "@/lib/actions/groups";
import { getTagsForItems, tagItemForGroupDate, tagItemForMyOccasion, untagItem } from "@/lib/actions/item-occasions";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { resolveStoredImageValue } from "@/lib/storage/image-value";
import { ALREADY_TAGGED, NOT_SIGNED_IN, TAG_GONE, databaseFailure } from "./action-response";
import { pathUuid } from "./database";
import { occasionKey, type MobileOccasion } from "./occasions";
import { occasionRows, profiles, upcomingForCaller } from "./people-live";
import { mobileError } from "./route";
import {
  RULES,
  bySoonest,
  formDataFromBody,
  isOneOfMyGroups,
  itemTags,
  mobileGroups,
  mobileItem,
  namesToRead,
  parseWishlistBody,
  planTags,
  rowsToRead,
  tagChoices,
  wishlistOccasion,
  type GroupRow,
  type MobileGroup,
  type MobileItem,
  type Tag,
  type TagPlan,
  type WishlistBody,
  type WishlistItemRow,
} from "./wishlist";

/** A save whose body has no occasions changes no tags. */
const NO_TAG_CHANGES: TagPlan = { add: [], remove: [] };

/** What the caller may tag one of their items for now, or the Response to send instead. */
async function loadChoices(userId: string): Promise<Response | UpcomingOccasion[]> {
  const upcoming = await upcomingForCaller();
  if (upcoming instanceof Response) return upcoming;
  return tagChoices(upcoming, userId);
}

export async function wishlistChoices(userId: string): Promise<Response | { occasions: MobileOccasion[] }> {
  const choices = await loadChoices(userId);
  if (choices instanceof Response) return choices;
  return { occasions: choices.map((o) => wishlistOccasion(o, userId)) };
}

/**
 * The choices, and each of these items' tags (itemTags), or the Response to send instead. A failed read fails the
 * request: an item answered with no tags could be saved back with none.
 */
async function loadTags(
  userId: string,
  itemIds: string[],
): Promise<Response | { choices: UpcomingOccasion[]; tags: Map<string, Tag[]> }> {
  const [choices, result] = await Promise.all([loadChoices(userId), getTagsForItems(itemIds)]);
  if (choices instanceof Response) return choices;
  const failed = databaseFailure(result, "getTagsForItems");
  if (failed) return failed;
  const tagged = (result as { data: Record<string, string[]> }).data;
  const rows = await occasionRows(rowsToRead(tagged, choices));
  const names = await profiles(namesToRead(rows, userId));
  return { choices, tags: itemTags(tagged, choices, rows, names, userId) };
}

const occasionsOf = (tags: Map<string, Tag[]>, itemId: string): MobileOccasion[] =>
  (tags.get(itemId) ?? []).map((tag) => tag.occasion);

/** One tag write: true once it is done. Any other answer, or a throw, is logged and is false. */
async function tagWrite(what: string, write: () => Promise<object>, alreadyDone: string): Promise<boolean> {
  try {
    const result = await write();
    const error: unknown = "error" in result ? result.error : undefined;
    if (error === undefined || error === null || error === alreadyDone) return true;
    console.error(`[mobile] wishlist: ${what} failed:`, error);
  } catch (thrown) {
    console.error(`[mobile] wishlist: ${what} failed:`, thrown);
  }
  return false;
}

/**
 * Carries out `plan` on an item that is already written, through the website's own actions. A tag that cannot be
 * written then (say its date was deleted in between) does not fail the request: it is logged, and the answer is the
 * item's tags as they then stand.
 */
async function writeTags(userId: string, itemId: string, current: Tag[], plan: TagPlan): Promise<MobileOccasion[]> {
  const [removed, added] = await Promise.all([
    Promise.all(plan.remove.map((tag) =>
      tagWrite(`untagging ${itemId} from ${tag.occasion.key}`, () => untagItem(itemId, tag.occasionId), TAG_GONE))),
    Promise.all(plan.add.map(({ occasion, target }) =>
      tagWrite(
        `tagging ${itemId} for ${occasionKey(occasion)}`,
        () => (target.via === "my" ? tagItemForMyOccasion(itemId, target.kind) : tagItemForGroupDate(itemId, target.occasionId)),
        ALREADY_TAGGED,
      ))),
  ]);
  const gone = new Set(plan.remove.filter((_, i) => removed[i]));
  return [
    ...current.filter((tag) => !gone.has(tag)).map((tag) => tag.occasion),
    ...plan.add.filter((_, i) => added[i]).map(({ occasion }) => wishlistOccasion(occasion, userId)),
  ].sort(bySoonest);
}

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

export async function listWishlist(userId: string): Promise<Response | { items: MobileItem[] }> {
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
  const loaded = await loadTags(userId, rows.map((row) => row.id));
  if (loaded instanceof Response) return loaded;
  return { items: rows.map((row) => mobileItem(row, groups, occasionsOf(loaded.tags, row.id))) };
}

export async function addWishlistItem(userId: string, raw: unknown): Promise<Response | { item: MobileItem }> {
  const checked = await checkedBody(userId, raw);
  if (checked instanceof Response) return checked;
  // A new item has no tags, so every key must be one of the choices. Decided before anything is written.
  let plan = NO_TAG_CHANGES;
  const keys = checked.body.occasions;
  if (keys !== null && keys.length > 0) {
    const choices = await loadChoices(userId);
    if (choices instanceof Response) return choices;
    const planned = planTags(keys, [], choices);
    if (planned === null) return mobileError("invalid", RULES.chooseDate);
    plan = planned;
  }
  const result = await createWishlistItem(formDataFromBody(checked.body));
  const failure = databaseFailure(result, "createWishlistItem");
  if (failure) return failure;
  const row = (result as { data: WishlistItemRow }).data;
  return { item: mobileItem(row, checked.groups, await writeTags(userId, row.id, [], plan)) };
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
  // The item's tags are read before anything is written: the answer names them, and a key it is tagged for is kept.
  const loaded = await loadTags(userId, [lookup.itemId]);
  if (loaded instanceof Response) return loaded;
  const current = loaded.tags.get(lookup.itemId) ?? [];
  // A body with no occasions (an app from before they were sent) leaves the tags as they are.
  const keys = checked.body.occasions;
  const plan = keys === null ? NO_TAG_CHANGES : planTags(keys, current, loaded.choices);
  if (plan === null) return mobileError("invalid", RULES.chooseDate);
  const result = await updateWishlistItem(lookup.itemId, formDataFromBody(checked.body));
  if ("error" in result && result.error && result.error !== NOT_SIGNED_IN) {
    // The update may have failed because the item was deleted since the lookup.
    const again = await findMine(userId, lookup.itemId, mobileError("not_found"));
    if (!again.found) return again.response ?? mobileError("not_found");
  }
  const failure = databaseFailure(result, "updateWishlistItem");
  if (failure) return failure;
  const row = (result as { data: WishlistItemRow }).data;
  return { item: mobileItem(row, checked.groups, await writeTags(userId, lookup.itemId, current, plan)) };
}

/** Deleting what is not there, or not yours, answers like deleting your own: nothing to report. */
export async function removeWishlistItem(userId: string, itemId: string): Promise<Response | null> {
  const lookup = await findMine(userId, itemId, null);
  if (!lookup.found) return lookup.response;
  const result = await deleteWishlistItem(lookup.itemId);
  return databaseFailure(result, "deleteWishlistItem");
}
