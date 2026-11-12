import { getMyGroups } from "@/lib/actions/groups";
import { getSharedGroups } from "@/lib/actions/profile";
import { markAsPurchased } from "@/lib/actions/wishlist";
import { todayISO } from "@/lib/claims/active";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { createClient } from "@/lib/supabase/server";
import type { GiftStatus } from "@/lib/schemas/gift-tracking";
import { resolveStoredImageValue } from "@/lib/storage/image-value";
import { NOT_SIGNED_IN, NOT_THE_CLAIMER, databaseFailure } from "./action-response";
import { resolveOccasionId } from "./claim-live";
import { NOT_SIGNED_IN_CODE, PERSON_ID, REFUSED, pathUuid } from "./database";
import type { GiftPatch, GiftStore } from "./gift-store";
import { createGiftStore } from "./gift-store-live";
import { loadGiftViews } from "./gift-views-live";
import {
  buildGiftList,
  giftSeason,
  parseGiftBody,
  parseStepBody,
  planStep,
  type GiftBody,
  type GiftListAnswer,
  type GiftView,
  type MobileGift,
  type RecipientRow,
} from "./gifts";
import { mobileOccasion, occasionKey, type MobileOccasion, type PersonRow } from "./occasions";
import { groupMembers, occasionsForPerson, profiles, upcomingForCaller } from "./people-live";
import { reconcileGifts, recipientFor } from "./reconcile";
import { mobileError } from "./route";
import { SHOPPING_RULES } from "./shopping-rules";
import { buildChoices } from "./shopping";
import { RULES, type GroupRow } from "./wishlist";

const SEASON = /^\d{4}$/;

type Answer<T> = Response | T;

/** The caller's gift with this (lower-case) id, as the app shows it; undefined when it is not the caller's. */
async function findView(userId: string, store: GiftStore, today: string, giftId: string): Promise<GiftView | undefined> {
  return (await loadGiftViews(userId, store, today)).find((v) => v.gift.id === giftId);
}

/** The gift as it now stands. A gift that was just written and is not there is a fault. */
async function answerView(userId: string, store: GiftStore, today: string, giftId: string): Promise<{ gift: MobileGift }> {
  const view = await findView(userId, store, today, giftId);
  if (!view) throw new Error(`gift ${giftId} is not among the caller's gifts`);
  return { gift: view.gift };
}

/** The group dates among the caller's upcoming occasions: what a typed name may be given. */
async function groupDates(): Promise<Answer<UpcomingOccasion[]>> {
  const upcoming = await upcomingForCaller();
  if (upcoming instanceof Response) return upcoming;
  return upcoming.filter((o) => o.kind === "group_date");
}

/** The occasions a gift may be filed under: a person's own (§5.1), or the group dates for a typed name. */
async function choicesFor(personId: string | null): Promise<Answer<UpcomingOccasion[]>> {
  return personId !== null ? occasionsForPerson(personId) : groupDates();
}

/** The members of each of the caller's groups, or the Response to send instead. */
async function myGroupMembers(): Promise<Answer<Map<string, PersonRow[]>>> {
  const groups = await getMyGroups();
  const failed = databaseFailure(groups, "getMyGroups");
  if (failed) return failed;
  const ids = (groups.data as GroupRow[]).flatMap((r) => (typeof r.id === "string" ? [r.id] : []));
  return groupMembers(ids);
}

export async function giftListAnswer(userId: string, season: string | null): Promise<Answer<GiftListAnswer>> {
  if (season !== null && !SEASON.test(season)) return mobileError("invalid", RULES.request);
  const today = todayISO();
  const store = await createGiftStore(userId);
  await reconcileGifts(store, today);
  // The occasions, and the groups with their members, do not depend on the gifts or on each other.
  const [views, upcoming, members] = await Promise.all([
    loadGiftViews(userId, store, today),
    upcomingForCaller(),
    myGroupMembers(),
  ]);
  if (upcoming instanceof Response) return upcoming;
  if (members instanceof Response) return members;

  return buildGiftList({
    views,
    season: season === null ? null : Number(season),
    currentYear: Number(today.slice(0, 4)),
    choices: buildChoices({ callerId: userId, upcoming, members }),
  });
}

export async function giftAnswer(
  userId: string,
  rawGiftId: string,
): Promise<Answer<{ gift: MobileGift; occasions: MobileOccasion[] }>> {
  const giftId = pathUuid(rawGiftId);
  if (giftId === null) return mobileError("not_found");
  const today = todayISO();
  const store = await createGiftStore(userId);
  await reconcileGifts(store, today);
  const view = await findView(userId, store, today, giftId);
  if (!view) return mobileError("not_found");
  const choices = await choicesFor(view.personId);
  if (choices instanceof Response) return choices;
  return { gift: view.gift, occasions: choices.map(mobileOccasion) };
}

type Who = { kind: "person"; profile: PersonRow } | { kind: "typed"; name: string };

/**
 * Who a hand-added gift is for, checked and not yet written: a person must be someone the caller shares a group with
 * (never the caller); a typed name is taken as given. Nothing is created here, so a later refusal leaves nothing behind.
 */
async function resolveWho(userId: string, body: GiftBody): Promise<Answer<Who>> {
  if (body.person === null) {
    if (body.recipientName === null) return mobileError("invalid", SHOPPING_RULES.chooseWho);
    return { kind: "typed", name: body.recipientName };
  }
  if (body.person === userId || !PERSON_ID.test(body.person)) return mobileError("invalid", SHOPPING_RULES.chooseWho);
  const shared = await getSharedGroups(body.person);
  const failed = databaseFailure(shared, "getSharedGroups");
  if (failed) return failed;
  const groups = ("data" in shared ? shared.data : undefined) ?? [];
  if (groups.length === 0) return mobileError("invalid", SHOPPING_RULES.chooseWho);
  const profile = (await profiles([body.person])).get(body.person);
  if (!profile) return mobileError("invalid", SHOPPING_RULES.chooseWho);
  return { kind: "person", profile };
}

/**
 * The caller's recipient for this person, or the one with this typed name (the door trims it, the site does not, so a
 * stored name is compared trimmed, an exact one first); made when there is none.
 */
async function recipientOf(store: GiftStore, who: Who): Promise<RecipientRow> {
  if (who.kind === "person") return recipientFor(store, who.profile);
  const named = (rows: RecipientRow[]) =>
    rows.find((r) => r.name === who.name) ?? rows.find((r) => r.name.trim() === who.name);
  const found = named(await store.recipients());
  if (found) return found;
  const made = await store.insertRecipient({ name: who.name, person_id: null });
  if (made.ok) return made.row;
  // A request alongside made it first.
  const again = named(await store.recipients());
  if (again) return again;
  throw new Error("recipientOf: the typed name clashed but no recipient has it");
}

/** The picture value to store: the caller's own path, an outside address, or none. A refusal is the 422 to send. */
function pictureValue(userId: string, imagePath: string | null): Response | { value: string | null } {
  const resolved = resolveStoredImageValue(imagePath, userId);
  if (!resolved.ok) return mobileError("invalid", resolved.error);
  return { value: resolved.value };
}

/** The occasion a key stands for among `allowed`: its row id and date, or none for no occasion. */
async function occasionFor(
  key: string | null,
  allowed: UpcomingOccasion[],
): Promise<Response | { occasionId: string | null; occasionDate: string | null }> {
  if (key === null) return { occasionId: null, occasionDate: null };
  return resolveOccasionId(key, allowed);
}

export async function addGiftAnswer(userId: string, raw: unknown): Promise<Answer<{ gift: MobileGift }>> {
  const parsed = parseGiftBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const body = parsed.body;
  const picture = pictureValue(userId, body.imagePath);
  if (picture instanceof Response) return picture;

  const who = await resolveWho(userId, body);
  if (who instanceof Response) return who;
  const today = todayISO();
  let occasion: { occasionId: string | null; occasionDate: string | null } = { occasionId: null, occasionDate: null };
  if (body.occasion !== null) {
    const allowed = await choicesFor(who.kind === "person" ? who.profile.id : null);
    if (allowed instanceof Response) return allowed;
    const resolved = await occasionFor(body.occasion, allowed);
    if (resolved instanceof Response) return resolved;
    occasion = resolved;
  }

  const store = await createGiftStore(userId);
  const recipient = await recipientOf(store, who);
  const inserted = await store.insertGift({
    recipient_id: recipient.id,
    name: body.name,
    description: body.description,
    photo_url: picture.value,
    product_link: body.link,
    price: body.price,
    notes: body.notes,
    occasion_id: occasion.occasionId,
    status: "planned",
    wishlist_item_id: null,
    from_list: false,
    season_year: giftSeason(occasion.occasionDate, today),
  });
  // A hand-added gift has no item, so the item index cannot clash.
  if (!inserted.ok) throw new Error("insertGift reported an item clash for a gift with no item");
  return answerView(userId, store, today, inserted.row.id);
}

export async function saveGiftAnswer(userId: string, rawGiftId: string, raw: unknown): Promise<Answer<{ gift: MobileGift }>> {
  const parsed = parseGiftBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const body = parsed.body;
  const picture = pictureValue(userId, body.imagePath);
  if (picture instanceof Response) return picture;
  const giftId = pathUuid(rawGiftId);
  if (giftId === null) return mobileError("not_found");

  const today = todayISO();
  const store = await createGiftStore(userId);
  const view = await findView(userId, store, today, giftId);
  if (!view) return mobileError("not_found");
  const gift = view.gift;

  // Who: a gift from a list keeps its recipient whatever the body says (its person can be unseen by now).
  // A hand-added gift for the same person (or typed name) it already has is not checked again: they may have left the
  // caller's groups since, and a notes-only edit must still go through. A typed name is compared trimmed, as the door
  // trims what the app sends back.
  let who: Who | null = null;
  if (!gift.fromList) {
    const current = (await store.recipients()).find((r) => r.id === view.recipientId);
    const unchanged = current !== undefined &&
      (body.person !== null
        ? current.person_id === body.person
        : current.person_id === null && current.name.trim() === body.recipientName);
    if (!unchanged) {
      const resolved = await resolveWho(userId, body);
      if (resolved instanceof Response) return resolved;
      who = resolved;
    }
  }

  const patch: GiftPatch = {
    name: body.name,
    description: body.description,
    photo_url: picture.value,
    product_link: body.link,
    price: body.price,
    notes: body.notes,
  };

  // Occasion: left alone when it is the one the gift has, even if it has passed or is no longer offered.
  if (body.occasion !== (gift.occasion?.key ?? null)) {
    // D12: for a gift from a list the claim's occasion is the truth; whether it is held is checked before anything is read.
    if (gift.fromList && (!gift.held || gift.itemId === null)) return mobileError("invalid", SHOPPING_RULES.notHeld);
    const allowed = await choicesFor(who !== null ? (who.kind === "person" ? who.profile.id : null) : view.personId);
    if (allowed instanceof Response) return allowed;
    if (gift.fromList && gift.itemId !== null) {
      // The database moves the claim, and its word is final.
      const resolved = await occasionFor(body.occasion, allowed);
      if (resolved instanceof Response) return resolved;
      const refused = await moveClaim(gift.itemId, resolved.occasionId);
      if (refused) return refused;
      patch.occasion_id = resolved.occasionId;
      patch.season_year = giftSeason(resolved.occasionDate, view.createdAt);
    } else {
      const resolved = await occasionFor(body.occasion, allowed);
      if (resolved instanceof Response) return resolved;
      patch.occasion_id = resolved.occasionId;
      patch.season_year = giftSeason(resolved.occasionDate, view.createdAt);
    }
  } else if (who !== null && body.occasion !== null) {
    // A hand-added gift given to someone else keeps its occasion only if it is one of theirs: a gift for Dad is never
    // left filed under Mom's birthday.
    const allowed = await choicesFor(who.kind === "person" ? who.profile.id : null);
    if (allowed instanceof Response) return allowed;
    if (!allowed.some((o) => occasionKey(o) === body.occasion)) return mobileError("invalid", SHOPPING_RULES.chooseOccasion);
  }

  patch.recipient_id = who !== null ? (await recipientOf(store, who)).id : view.recipientId;
  const updated = await store.updateGift(giftId, patch);
  if (updated === null) return mobileError("not_found");
  if (!updated.ok) throw new Error("updateGift reported an item clash for a patch that does not touch the item");
  return answerView(userId, store, today, giftId);
}

/** Asks the database to move the caller's claim. The 422 to send when it refuses, null when it has moved. */
async function moveClaim(itemId: string, occasionId: string | null): Promise<Response | null> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_claim_occasion", { p_item_id: itemId, p_occasion_id: occasionId });
  if (!error) return null;
  if (error.code === NOT_SIGNED_IN_CODE) return mobileError("unauthorized");
  if (error.code === REFUSED) {
    const message = error.message.toLowerCase();
    if (message.includes("you no longer hold that item")) return mobileError("invalid", SHOPPING_RULES.notHeld);
    if (message.includes("that occasion is not available")) return mobileError("invalid", SHOPPING_RULES.chooseOccasion);
  }
  throw new Error(`set_claim_occasion failed: ${error.code ?? ""} ${error.message}`);
}

/**
 * One step forward or back, made only if the gift is still at the stage the app saw (`from`). A retry after a lost
 * answer, or a second tap, finds the gift moved and gets it as it now is, so a gift never moves twice. The write
 * itself is conditional on the stored status, so two requests at once cannot both make the step.
 */
export async function stepGiftAnswer(userId: string, rawGiftId: string, raw: unknown): Promise<Answer<{ gift: MobileGift }>> {
  const parsed = parseStepBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const giftId = pathUuid(rawGiftId);
  if (giftId === null) return mobileError("not_found");
  const { direction, from } = parsed;

  const today = todayISO();
  const store = await createGiftStore(userId);
  const view = await findView(userId, store, today, giftId);
  if (!view) return mobileError("not_found");
  const gift = view.gift;
  if (gift.status !== from) return { gift };

  const plan = planStep(
    {
      status: view.status,
      fromList: gift.fromList,
      // An item that has gone or cannot be seen is never marked: marking it would fail and answer 500. A hidden one
      // is not crossed between Claimed and Ordered at all; a deleted one's gift steps alone.
      itemLinked: gift.itemId !== null && !gift.itemGone,
      itemHidden: view.itemHidden,
      held: gift.held,
      occasionDate: gift.occasion?.date ?? null,
      today,
    },
    direction,
  );
  if (!plan.ok) return mobileError("invalid", plan.message);

  // The gift moves first, and only if it is still where it was read. Only the request that moved it touches the item.
  const updated = await store.updateGift(giftId, { status: plan.to }, { status: view.status });
  if (updated !== null && !updated.ok) throw new Error("updateGift reported an item clash for a status change");
  if (updated !== null && plan.markBought !== null && gift.itemId !== null) {
    const refusal = await markItem(gift.itemId, plan.markBought);
    if (refusal) {
      await putBack(store, giftId, view.status, plan.to, refusal.failure);
      if (refusal.response) return refusal.response;
      throw refusal.failure;
    }
  }
  // null: another request moved it first (or it has gone). Answer it as it now is.
  const now = await findView(userId, store, today, giftId);
  return now ? { gift: now.gift } : mobileError("not_found");
}

/** Marks or un-marks the item. Null when done; otherwise the answer to send (a Response) or the fault to throw. */
async function markItem(itemId: string, bought: boolean): Promise<{ response: Response | null; failure: unknown } | null> {
  try {
    const marked = await markAsPurchased(itemId, bought);
    if (!("error" in marked) || !marked.error) return null;
    if (marked.error === NOT_SIGNED_IN) return { response: mobileError("unauthorized"), failure: marked.error };
    if (marked.error === NOT_THE_CLAIMER) return { response: mobileError("invalid", SHOPPING_RULES.notHeld), failure: marked.error };
    return { response: null, failure: new Error(`markAsPurchased failed: ${marked.error}`) };
  } catch (failure) {
    return { response: null, failure };
  }
}

/**
 * The item could not be marked, so the gift goes back to the stage it had: conditional on it still being where this
 * request put it, so a later step by another request is never undone. A put-back that fails is logged beside the
 * first failure, which still decides the answer.
 */
async function putBack(store: GiftStore, giftId: string, was: GiftStatus, now: GiftStatus, first: unknown): Promise<void> {
  try {
    await store.updateGift(giftId, { status: was }, { status: now });
  } catch (putBackFailure) {
    console.error("stepGiftAnswer: putting the gift back failed too:", putBackFailure, "after:", first);
  }
}

export async function deleteGiftAnswer(userId: string, rawGiftId: string): Promise<Answer<null>> {
  const giftId = pathUuid(rawGiftId);
  if (giftId === null) return null;
  const today = todayISO();
  const store = await createGiftStore(userId);
  const view = await findView(userId, store, today, giftId);
  if (!view) return null;
  // A held gift is released, not deleted; except one past Claimed whose item the caller can no longer see, which can
  // be neither stepped back nor released. Its claim is left as it is: the record that the item was bought.
  if (!view.gift.canRemove) return mobileError("invalid", SHOPPING_RULES.releaseInstead);
  await store.deleteGift(giftId);
  return null;
}
