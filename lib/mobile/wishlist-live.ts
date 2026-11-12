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

/** The occasion ids each of these items is tagged for, or the Response to send instead. A database fault throws. */
async function readTagged(itemIds: string[]): Promise<Response | Record<string, string[]>> {
  const result = await getTagsForItems(itemIds);
  const failed = databaseFailure(result, "getTagsForItems");
  if (failed) return failed;
  return (result as { data: Record<string, string[]> }).data;
}

/** Each item's tags (itemTags), a date that is not among the choices described from its row. A database fault throws. */
async function describeTags(
  userId: string,
  tagged: Record<string, string[]>,
  choices: UpcomingOccasion[],
): Promise<Map<string, Tag[]>> {
  const rows = await occasionRows(rowsToRead(tagged, choices));
  const names = await profiles(namesToRead(rows, userId));
  return itemTags(tagged, choices, rows, names, userId);
}

/**
 * The choices, and each of these items' tags (itemTags), or the Response to send instead. A failed read fails the
 * request: an item answered with no tags could be saved back with none.
 */
async function loadTags(
  userId: string,
  itemIds: string[],
): Promise<Response | { choices: UpcomingOccasion[]; tags: Map<string, Tag[]> }> {
  const [choices, tagged] = await Promise.all([loadChoices(userId), readTagged(itemIds)]);
  if (choices instanceof Response) return choices;
  if (tagged instanceof Response) return tagged;
  return { choices, tags: await describeTags(userId, tagged, choices) };
}

const occasionsOf = (tags: Map<string, Tag[]>, itemId: string): MobileOccasion[] =>
  (tags.get(itemId) ?? []).map((tag) => tag.occasion);

/**
 * One tag write. Done, it gives the action's answer, or "already" when the action said it was done before; anything
 * else, or a throw, is logged and gives null.
 */
async function tagWrite(what: string, write: () => Promise<object>, alreadyDone: string): Promise<object | "already" | null> {
  try {
    const result = await write();
    const error: unknown = "error" in result ? result.error : undefined;
    if (error === undefined || error === null) return result;
    if (error === alreadyDone) return "already";
    console.error(`[mobile] wishlist: ${what} failed:`, error);
  } catch (thrown) {
    console.error(`[mobile] wishlist: ${what} failed:`, thrown);
  }
  return null;
}

/** The occasion a tagging action says it tagged; null when it said only that the tag was there already. */
function landedOn(outcome: object | "already"): string | null {
  if (outcome === "already") return null;
  const data: unknown = "data" in outcome ? outcome.data : undefined;
  const id: unknown = typeof data === "object" && data !== null && "occasionId" in data ? data.occasionId : undefined;
  return typeof id === "string" ? id : null;
}

/** The dates just tagged on occasions other than the ones offered, described from their rows; as offered if unreadable. */
async function describeLanded(
  userId: string,
  itemId: string,
  landed: { occasionId: string; offered: UpcomingOccasion }[],
): Promise<MobileOccasion[]> {
  if (landed.length === 0) return [];
  try {
    return occasionsOf(await describeTags(userId, { [itemId]: landed.map((l) => l.occasionId) }, []), itemId);
  } catch (error) {
    console.error(`[mobile] wishlist: reading what ${itemId} was just tagged for failed:`, error);
    return landed.map((l) => wishlistOccasion(l.offered, userId));
  }
}

/** The item's tags read again after it was written; null, logged, when they cannot be. */
async function readAgain(userId: string, itemId: string, choices: UpcomingOccasion[]): Promise<MobileOccasion[] | null> {
  try {
    const tagged = await readTagged([itemId]);
    if (tagged instanceof Response) throw new Error("getTagsForItems found nobody signed in");
    return occasionsOf(await describeTags(userId, tagged, choices), itemId);
  } catch (error) {
    console.error(`[mobile] wishlist: reading ${itemId}'s tags again failed:`, error);
    return null;
  }
}

/**
 * Carries out `plan` on an item that is already written, through the website's own actions, and answers its tags as
 * they then stand. Every removal finishes before any addition starts, so the two never meet on one row.
 *
 * A group date is tagged on its own row. A date of the caller's own lands on whichever row get_or_create_occasion
 * picks, which for a couple's anniversary can be one the item already has, or one stored under a key other than the
 * one offered: the answer names the row it landed on. When the action says only that the tag was already there, the
 * item's tags are read again.
 *
 * Nothing here fails the request: a tag that cannot be written (say its date was deleted in between), or a read that
 * fails, is logged, and the answer is what the writes said.
 */
async function writeTags(
  userId: string,
  itemId: string,
  current: Tag[],
  plan: TagPlan,
  choices: UpcomingOccasion[],
): Promise<MobileOccasion[]> {
  const removed = await Promise.all(plan.remove.map((tag) =>
    tagWrite(`untagging ${itemId} from ${tag.occasion.key}`, () => untagItem(itemId, tag.occasionId), TAG_GONE)));
  const added = await Promise.all(plan.add.map(({ occasion, target }) =>
    tagWrite(
      `tagging ${itemId} for ${occasionKey(occasion)}`,
      () => (target.via === "my" ? tagItemForMyOccasion(itemId, target.kind) : tagItemForGroupDate(itemId, target.occasionId)),
      ALREADY_TAGGED,
    )));

  const gone = new Set(plan.remove.filter((_, i) => removed[i] !== null));
  const stands = current.filter((tag) => !gone.has(tag));
  const tagged = new Set(stands.map((tag) => tag.occasionId));
  const answer = stands.map((tag) => tag.occasion);
  const landedElsewhere: { occasionId: string; offered: UpcomingOccasion }[] = [];
  let readAgainNeeded = false;
  plan.add.forEach(({ occasion, target }, i) => {
    const outcome = added[i];
    if (outcome === null) return;
    const landed = target.via === "group" ? target.occasionId : landedOn(outcome);
    if (landed === null) {
      readAgainNeeded = true;
      answer.push(wishlistOccasion(occasion, userId));
      return;
    }
    if (tagged.has(landed)) return;
    tagged.add(landed);
    if (landed === occasion.occasionId) answer.push(wishlistOccasion(occasion, userId));
    else landedElsewhere.push({ occasionId: landed, offered: occasion });
  });

  if (readAgainNeeded) {
    const again = await readAgain(userId, itemId, choices);
    if (again !== null) return again;
  }
  answer.push(...(await describeLanded(userId, itemId, landedElsewhere)));
  return answer.sort(bySoonest);
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
  let choices: UpcomingOccasion[] = [];
  const keys = checked.body.occasions;
  if (keys !== null && keys.length > 0) {
    const loaded = await loadChoices(userId);
    if (loaded instanceof Response) return loaded;
    choices = loaded;
    const planned = planTags(keys, [], choices);
    if (planned === null) return mobileError("invalid", RULES.chooseDate);
    plan = planned;
  }
  const result = await createWishlistItem(formDataFromBody(checked.body));
  const failure = databaseFailure(result, "createWishlistItem");
  if (failure) return failure;
  const row = (result as { data: WishlistItemRow }).data;
  return { item: mobileItem(row, checked.groups, await writeTags(userId, row.id, [], plan, choices)) };
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
  return { item: mobileItem(row, checked.groups, await writeTags(userId, lookup.itemId, current, plan, loaded.choices)) };
}

/** Deleting what is not there, or not yours, answers like deleting your own: nothing to report. */
export async function removeWishlistItem(userId: string, itemId: string): Promise<Response | null> {
  const lookup = await findMine(userId, itemId, null);
  if (!lookup.found) return lookup.response;
  const result = await deleteWishlistItem(lookup.itemId);
  return databaseFailure(result, "deleteWishlistItem");
}
