import { getMyGroups } from "@/lib/actions/groups";
import { getSharedGroups } from "@/lib/actions/profile";
import { markAsPurchased } from "@/lib/actions/wishlist";
import { todayISO } from "@/lib/claims/active";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { createClient } from "@/lib/supabase/server";
import { resolveStoredImageValue } from "@/lib/storage/image-value";
import { NOT_SIGNED_IN, databaseFailure } from "./action-response";
import { resolveOccasionId } from "./claim-live";
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
  type StepDirection,
} from "./gifts";
import { mobileOccasion, type MobileOccasion, type PersonRow } from "./occasions";
import { groupMembers, occasionsForPerson, profiles, upcomingForCaller } from "./people-live";
import { reconcileGifts, recipientFor } from "./reconcile";
import { mobileError } from "./route";
import { SHOPPING_RULES } from "./shopping-rules";
import { buildChoices } from "./shopping";
import { RULES, type GroupRow } from "./wishlist";
import { UUID } from "./wishlist-live";

/** The database's refusals are all SQLSTATE 22023 (types/database.ts); anything else is a fault. */
const REFUSED = "22023";

/** The refusal text markAsPurchased answers for a claim the caller does not hold (lib/actions/wishlist.ts). */
const NOT_THE_CLAIMER = "Only the person who claimed this item can mark it purchased";

/** Clerk ids are letters, digits and underscores; anything else cannot be a person, so it is never sent to the database. */
const PERSON_ID = /^[A-Za-z0-9_]{1,128}$/;

const SEASON = /^\d{4}$/;

type Answer<T> = Response | T;

/** The caller's gift with this id, as the app shows it; undefined when it is not the caller's (or not a gift at all). */
async function findView(userId: string, store: GiftStore, today: string, giftId: string): Promise<GiftView | undefined> {
  if (!UUID.test(giftId)) return undefined;
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

export async function giftListAnswer(userId: string, season: string | null): Promise<Answer<GiftListAnswer>> {
  if (season !== null && !SEASON.test(season)) return mobileError("invalid", RULES.request);
  const today = todayISO();
  const store = await createGiftStore(userId);
  await reconcileGifts(store, today);
  const views = await loadGiftViews(userId, store, today);
  const upcoming = await upcomingForCaller();
  if (upcoming instanceof Response) return upcoming;

  const groups = await getMyGroups();
  const failed = databaseFailure(groups, "getMyGroups");
  if (failed) return failed;
  const ids = (groups.data as GroupRow[]).flatMap((r) => (typeof r.id === "string" ? [r.id] : []));
  const members = await groupMembers(ids);

  return buildGiftList({
    views,
    season: season === null ? null : Number(season),
    currentYear: Number(today.slice(0, 4)),
    choices: buildChoices({ callerId: userId, upcoming, members }),
  });
}

export async function giftAnswer(
  userId: string,
  giftId: string,
): Promise<Answer<{ gift: MobileGift; occasions: MobileOccasion[] }>> {
  if (!UUID.test(giftId)) return mobileError("not_found");
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

/** The caller's recipient for this person, or the one with exactly this typed name; made when there is none. */
async function recipientOf(store: GiftStore, who: Who): Promise<RecipientRow> {
  if (who.kind === "person") return recipientFor(store, who.profile);
  const named = (rows: RecipientRow[]) => rows.find((r) => r.name === who.name);
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
  const resolved = await resolveOccasionId(key, allowed);
  if (!resolved.ok) return mobileError("invalid", SHOPPING_RULES.chooseOccasion);
  return { occasionId: resolved.occasionId, occasionDate: resolved.occasionDate };
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

export async function saveGiftAnswer(userId: string, giftId: string, raw: unknown): Promise<Answer<{ gift: MobileGift }>> {
  const parsed = parseGiftBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const body = parsed.body;
  const picture = pictureValue(userId, body.imagePath);
  if (picture instanceof Response) return picture;

  const today = todayISO();
  const store = await createGiftStore(userId);
  const view = await findView(userId, store, today, giftId);
  if (!view) return mobileError("not_found");
  const gift = view.gift;

  // Who: a gift from a list keeps its recipient whatever the body says (its person can be unseen by now).
  let who: Who | null = null;
  if (!gift.fromList) {
    const resolved = await resolveWho(userId, body);
    if (resolved instanceof Response) return resolved;
    who = resolved;
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
    const allowed = await choicesFor(who !== null ? (who.kind === "person" ? who.profile.id : null) : view.personId);
    if (allowed instanceof Response) return allowed;
    if (gift.fromList) {
      // D12: the claim's occasion is the truth; the database moves it, and its word is final.
      if (!gift.held || gift.itemId === null) return mobileError("invalid", SHOPPING_RULES.notHeld);
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
  if (error.code === REFUSED) {
    const message = error.message.toLowerCase();
    if (message.includes("you no longer hold that item")) return mobileError("invalid", SHOPPING_RULES.notHeld);
    if (message.includes("that occasion is not available")) return mobileError("invalid", SHOPPING_RULES.chooseOccasion);
  }
  throw new Error(`set_claim_occasion failed: ${error.code ?? ""} ${error.message}`);
}

type Settled = { ok: true; answer: Answer<{ gift: MobileGift }> } | { ok: false; error: unknown };
const stepping = new Map<string, { direction: StepDirection; settled: Promise<Settled> }>();

/**
 * One step forward or back. Requests for the same gift are never run side by side: one in the same direction that is
 * already on its way is the same tap sent twice, so it shares that request's answer and the gift moves one step; one in
 * the other direction waits its turn. (Held in this process only: a second server instance is not seen.)
 */
export async function stepGiftAnswer(userId: string, giftId: string, raw: unknown): Promise<Answer<{ gift: MobileGift }>> {
  const parsed = parseStepBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  if (!UUID.test(giftId)) return mobileError("not_found");
  const direction = parsed.direction;
  const key = `${userId}:${giftId}`;

  for (;;) {
    const running = stepping.get(key);
    if (!running) break;
    const outcome = await running.settled;
    if (running.direction === direction) return replay(outcome);
  }

  const settled: Promise<Settled> = stepOnce(userId, giftId, direction).then(
    (answer): Settled => ({ ok: true, answer }),
    (error): Settled => ({ ok: false, error }),
  );
  stepping.set(key, { direction, settled });
  try {
    return replay(await settled);
  } finally {
    if (stepping.get(key)?.settled === settled) stepping.delete(key);
  }
}

/** Every caller gets its own copy of a shared answer: a Response body can be read once. */
function replay(outcome: Settled): Answer<{ gift: MobileGift }> {
  if (!outcome.ok) throw outcome.error;
  return outcome.answer instanceof Response ? outcome.answer.clone() : outcome.answer;
}

async function stepOnce(userId: string, giftId: string, direction: StepDirection): Promise<Answer<{ gift: MobileGift }>> {
  const today = todayISO();
  const store = await createGiftStore(userId);
  const view = await findView(userId, store, today, giftId);
  if (!view) return mobileError("not_found");
  const gift = view.gift;

  const plan = planStep(
    {
      status: view.status,
      fromList: gift.fromList,
      // An item the caller can no longer see is stepped around: marking it would fail and answer 500.
      itemLinked: gift.itemId !== null && !gift.itemGone,
      held: gift.held,
      occasionDate: gift.occasion?.date ?? null,
      today,
    },
    direction,
  );
  if (!plan.ok) return mobileError("invalid", plan.message);

  if (plan.markBought !== null && gift.itemId !== null) {
    const marked = await markAsPurchased(gift.itemId, plan.markBought);
    if ("error" in marked && marked.error) {
      if (marked.error === NOT_SIGNED_IN) return mobileError("unauthorized");
      if (marked.error === NOT_THE_CLAIMER) return mobileError("invalid", SHOPPING_RULES.notHeld);
      throw new Error(`markAsPurchased failed: ${marked.error}`);
    }
  }

  const updated = await store.updateGift(giftId, { status: plan.to });
  if (updated === null) return mobileError("not_found");
  if (!updated.ok) throw new Error("updateGift reported an item clash for a status change");
  return answerView(userId, store, today, giftId);
}

export async function deleteGiftAnswer(userId: string, giftId: string): Promise<Answer<null>> {
  if (!UUID.test(giftId)) return null;
  const today = todayISO();
  const store = await createGiftStore(userId);
  const view = await findView(userId, store, today, giftId);
  if (!view) return null;
  if (view.gift.held) return mobileError("invalid", SHOPPING_RULES.releaseInstead);
  await store.deleteGift(giftId);
  return null;
}
