import { z } from "zod";
import { isClaimActive } from "@/lib/claims/active";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import type { GiftStatus } from "@/lib/schemas/gift-tracking";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import {
  mobileOccasion,
  mobilePerson,
  byPersonName,
  type MobileOccasion,
  type MobilePerson,
  type PersonRow,
} from "./occasions";
import { SHOPPING_RULES } from "./shopping-rules";
import {
  CONTROL,
  CONTROL_EXCEPT_NOTES_WHITESPACE,
  RULES,
  SPACE_OR_CONTROL,
  isWebLink,
  utcSeconds,
} from "./wishlist";

export type GiftStage = "claimed" | "planned" | "ordered" | "arrived" | "wrapped" | "given";
export const STAGES: readonly GiftStage[] = ["claimed", "planned", "ordered", "arrived", "wrapped", "given"];

/** A gift from a list that is still at the first step is the claim itself: the app calls it Claimed. */
export function giftStage(status: GiftStatus, fromList: boolean): GiftStage {
  return status === "planned" && fromList ? "claimed" : status;
}

export type StepDirection = "forward" | "back";

export interface StepFacts {
  status: GiftStatus;
  fromList: boolean;
  /** The gift points at an item the caller can see. */
  itemLinked: boolean;
  /** The gift still points at an item, but the caller's own read did not return it (hidden from them, or they left the group). */
  itemHidden: boolean;
  held: boolean;
  occasionDate: string | null;
  today: string;
}

export type StepPlan = { ok: true; to: GiftStatus; markBought: boolean | null } | { ok: false; message: string };

const ORDER: readonly GiftStatus[] = ["planned", "ordered", "arrived", "wrapped", "given"];

/** §5.3, D6, D7, D13. */
export function planStep(facts: StepFacts, direction: StepDirection): StepPlan {
  const i = ORDER.indexOf(facts.status);
  if (direction === "forward" && i === ORDER.length - 1) return { ok: false, message: SHOPPING_RULES.lastStep };
  if (direction === "back" && i === 0) return { ok: false, message: SHOPPING_RULES.firstStep };
  const to = ORDER[direction === "forward" ? i + 1 : i - 1];
  if (direction === "back" && facts.status === "ordered" && facts.occasionDate !== null && facts.occasionDate < facts.today) {
    return { ok: false, message: SHOPPING_RULES.pastOccasion };
  }
  // Crossing between Claimed and Ordered is what marks a list item bought or not bought.
  const crossesOrdered = facts.fromList
    && ((facts.status === "planned" && to === "ordered") || (facts.status === "ordered" && to === "planned"));
  // An item the caller cannot see cannot be marked, so neither crossing is made: going back would leave it bought
  // with nobody to answer for it once the claim is released (D7). A deleted item has nothing left to mark.
  if (crossesOrdered && facts.itemHidden) {
    return { ok: false, message: direction === "forward" ? SHOPPING_RULES.itemHiddenForward : SHOPPING_RULES.itemHiddenBack };
  }
  const touchesItem = crossesOrdered && facts.itemLinked;
  if (touchesItem && !facts.held) return { ok: false, message: SHOPPING_RULES.notHeld };
  return { ok: true, to, markBought: touchesItem ? direction === "forward" : null };
}

/** A tracked_gifts row as stored (photo_url is the stored value), with the columns the app uses. */
export interface StoredGift {
  id: string;
  recipient_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  product_link: string | null;
  price: number | null;
  status: GiftStatus;
  wishlist_item_id: string | null;
  from_list: boolean;
  occasion_id: string | null;
  /**
   * The column is nullable in the database (types/database.ts types it as a number, but it has no not-null rule).
   * Every writer here sets a year (NewGift); a null read is shown under the year the gift was added.
   */
  season_year: number | null;
  notes: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface RecipientRow {
  id: string;
  name: string;
  person_id: string | null;
}

export interface ClaimedItem {
  id: string;
  ownerId: string;
  title: string;
  description: string | null;
  url: string | null;
  price: number | null;
  /** The item's stored image_url. */
  imageValue: string | null;
  purchased: boolean;
}

/** One of the caller's claims with released_at null. item is null when the caller can no longer see the item. */
export interface ClaimRow {
  itemId: string;
  occasionId: string | null;
  occasionDate: string | null;
  /** When the claim was made (its claimed_at): an undated claim's gift belongs to that year's season. */
  claimedAt: string;
  item: ClaimedItem | null;
  owner: PersonRow | null;
}

export interface LinkedItem {
  id: string;
  ownerId: string;
  purchased: boolean;
  /** Signed. */
  imageUrl: string | null;
}

/** After withSignedGiftPhotos: photo_url is signed, photo_path is the stored value. */
export type GiftRow = StoredGift & { photo_path: string | null };

export interface GiftContext {
  recipients: ReadonlyMap<string, RecipientRow>;
  items: ReadonlyMap<string, LinkedItem>;
  held: ReadonlySet<string>;
  occasions: ReadonlyMap<string, UpcomingOccasion>;
  profiles: ReadonlyMap<string, PersonRow>;
  today: string;
}

export interface MobileGift {
  id: string;
  name: string;
  description: string | null;
  link: string | null;
  price: number | null;
  imageUrl: string | null;
  imagePath: string | null;
  status: GiftStage;
  fromList: boolean;
  itemId: string | null;
  held: boolean;
  itemGone: boolean;
  itemNotBought: boolean;
  canGoForward: boolean;
  canGoBack: boolean;
  canRelease: boolean;
  canRemove: boolean;
  person: MobilePerson | null;
  recipientName: string;
  occasion: MobileOccasion | null;
  seasonYear: number;
  notes: string | null;
  updatedAt: string;
}

export interface GiftView {
  gift: MobileGift;
  status: GiftStatus;
  /** From a list, still pointing at an item, and the caller's read did not return it. Not sent. */
  itemHidden: boolean;
  personId: string | null;
  occasionId: string | null;
  recipientId: string;
  archived: boolean;
  createdAt: string;
}

/** The item ids the caller holds an active claim on. */
export function heldItemIds(claims: ClaimRow[], today: string): Set<string> {
  const held = new Set<string>();
  for (const c of claims) {
    if (isClaimActive({ occasionId: c.occasionId, occasionDate: c.occasionDate, itemPurchased: c.item?.purchased ?? false }, today)) {
      held.add(c.itemId);
    }
  }
  return held;
}

/** §4.6, for a gift being written: the year of the occasion's date, else the year of `since` (UTC). */
export function giftSeason(occasionDate: string | null, since: string): number {
  return occasionDate !== null ? Number(occasionDate.slice(0, 4)) : new Date(since).getUTCFullYear();
}

/**
 * The season the app is told: the year of the gift's occasion when the caller can see it; otherwise the stored season;
 * otherwise (an empty column) the year the gift was added.
 */
function shownSeason(row: StoredGift, occasion: UpcomingOccasion | null): number {
  if (occasion) return Number(occasion.occasionDate.slice(0, 4));
  return row.season_year ?? giftSeason(null, row.created_at);
}

export function buildGiftViews(rows: GiftRow[], ctx: GiftContext): GiftView[] {
  return rows.map((row) => {
    const recipient = ctx.recipients.get(row.recipient_id);
    const item = row.wishlist_item_id ? ctx.items.get(row.wishlist_item_id) ?? null : null;
    const ownerId = item?.ownerId ?? recipient?.person_id ?? null;
    const personRow = ownerId !== null ? ctx.profiles.get(ownerId) : undefined;
    const personId = personRow ? ownerId : null;
    const occasion = row.occasion_id ? ctx.occasions.get(row.occasion_id) ?? null : null;
    const held = row.wishlist_item_id !== null && ctx.held.has(row.wishlist_item_id);
    const itemGone = row.from_list && item === null;
    // Hidden, not deleted: deleting an item clears the gift's item id.
    const itemHidden = itemGone && row.wishlist_item_id !== null;
    const facts: StepFacts = {
      status: row.status,
      fromList: row.from_list,
      itemLinked: row.wishlist_item_id !== null && !itemGone,
      itemHidden,
      held,
      occasionDate: occasion?.occasionDate ?? null,
      today: ctx.today,
    };
    const gift: MobileGift = {
      id: row.id,
      name: row.name,
      description: row.description,
      link: row.product_link,
      price: row.price !== null && row.price > 0 ? row.price : null,
      imageUrl: row.photo_url ?? item?.imageUrl ?? null,
      imagePath: row.photo_path,
      status: giftStage(row.status, row.from_list),
      fromList: row.from_list,
      itemId: row.wishlist_item_id,
      held,
      itemGone,
      itemNotBought: row.from_list && item !== null && !item.purchased && row.status !== "planned",
      canGoForward: planStep(facts, "forward").ok,
      canGoBack: planStep(facts, "back").ok,
      canRelease: row.from_list && held && row.status === "planned" && !(item?.purchased ?? false),
      // A hidden item's gift past Claimed can be stepped neither back nor released, so it may be removed while held;
      // its claim stays, as the record that the item was bought.
      canRemove: !held || (itemHidden && row.status !== "planned"),
      person: personRow ? mobilePerson(personRow) : null,
      recipientName: recipient?.name ?? "Someone",
      occasion: occasion ? mobileOccasion(occasion) : null,
      seasonYear: shownSeason(row, occasion),
      notes: row.notes,
      updatedAt: utcSeconds(row.updated_at),
    };
    return {
      gift,
      status: row.status,
      itemHidden,
      personId,
      occasionId: row.occasion_id,
      recipientId: row.recipient_id,
      archived: row.is_archived,
      createdAt: row.created_at,
    };
  });
}

/** STAGES order, then name, then id. */
export function compareGifts(a: MobileGift, b: MobileGift): number {
  return STAGES.indexOf(a.status) - STAGES.indexOf(b.status)
    || a.name.localeCompare(b.name, "en")
    || a.id.localeCompare(b.id, "en");
}

export interface PersonChoice {
  person: MobilePerson;
  occasions: MobileOccasion[];
}
export interface GiftChoices {
  people: PersonChoice[];
  groupDates: MobileOccasion[];
}
export interface GiftGroup {
  person: MobilePerson | null;
  name: string;
  gifts: MobileGift[];
}
export interface GiftListAnswer {
  season: number;
  seasons: number[];
  counts: Record<GiftStage, number>;
  groups: GiftGroup[];
  choices: GiftChoices;
}

export function buildGiftList(input: {
  views: GiftView[];
  season: number | null;
  currentYear: number;
  choices: GiftChoices;
}): GiftListAnswer {
  const live = input.views.filter((v) => !v.archived);
  const seasons = [...new Set([...live.map((v) => v.gift.seasonYear), input.currentYear])].sort((a, b) => b - a);
  const season = input.season ?? input.currentYear;
  const inSeason = live.filter((v) => v.gift.seasonYear === season);

  const counts: Record<GiftStage, number> = { claimed: 0, planned: 0, ordered: 0, arrived: 0, wrapped: 0, given: 0 };
  for (const v of inSeason) counts[v.gift.status] += 1;

  const byKey = new Map<string, { person: MobilePerson | null; name: string; gifts: MobileGift[] }>();
  for (const v of inSeason) {
    const key = v.personId !== null ? `person:${v.personId}` : `recipient:${v.recipientId}`;
    let group = byKey.get(key);
    if (!group) {
      group = { person: v.gift.person, name: v.gift.person?.name ?? v.gift.recipientName, gifts: [] };
      byKey.set(key, group);
    }
    group.gifts.push(v.gift);
  }
  const all = [...byKey.values()];
  for (const g of all) g.gifts.sort(compareGifts);
  const people = all.filter((g) => g.person !== null).sort((a, b) => byPersonName(a.person!, b.person!));
  const typed = all.filter((g) => g.person === null).sort((a, b) => a.name.localeCompare(b.name, "en"));

  return { season, seasons, counts, groups: [...people, ...typed], choices: input.choices };
}

const RECIPIENT_MAX = 100;
const FROM_LIST_SUFFIX = " (from their list)";

/** The name cut so that it and the suffix, kept whole, fit the tracker's 100 characters (code points). */
const withSuffix = (chars: string[], suffix: string) =>
  chars.slice(0, RECIPIENT_MAX - Array.from(suffix).length).join("") + suffix;

/** By code points, as the database's char_length counts. */
export function recipientNames(personName: string): { plain: string; fromList: string } {
  const chars = Array.from(personName);
  return { plain: chars.slice(0, RECIPIENT_MAX).join(""), fromList: withSuffix(chars, FROM_LIST_SUFFIX) };
}

/**
 * Every name a person's recipient may be given, in the order they are tried: the plain name, `<name> (from their list)`,
 * then `<name> (from their list) 2` to `9`, so a typed recipient and several people showing the same name each get one.
 */
export function recipientNameChoices(personName: string): string[] {
  const chars = Array.from(personName);
  const { plain, fromList } = recipientNames(personName);
  return [plain, fromList, ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => withSuffix(chars, `${FROM_LIST_SUFFIX} ${n}`))];
}

export interface GiftBody {
  person: string | null;
  recipientName: string | null;
  name: string;
  description: string | null;
  link: string | null;
  price: number | null;
  imagePath: string | null;
  occasion: string | null;
  notes: string | null;
}

/** The door's limits. Text is counted in code points, as the database's char_length counts (and recipientNames). */
const NAME_MAX = 200;
const DESCRIPTION_MAX = 1000;
const NOTES_MAX = 1000;
const LINK_MAX = 2048;
const PRICE_MAX = 1000000;
const codePoints = (v: string) => Array.from(v).length;
const cutTo = (v: string, max: number) => Array.from(v).slice(0, max).join("");

const linkSchema = z
  .string({ error: RULES.linkNotWeb })
  .trim()
  .max(LINK_MAX, RULES.linkTooLong)
  .refine((v) => !SPACE_OR_CONTROL.test(v), RULES.characters)
  .refine((v) => v === "" || isWebLink(v), RULES.linkNotWeb);

const giftBodySchema = z
  .object(
    {
      person: z.string({ error: SHOPPING_RULES.chooseWho }).min(1, SHOPPING_RULES.chooseWho).nullish(),
      recipientName: z
        .string({ error: RULES.request })
        .trim()
        .refine((v) => codePoints(v) <= RECIPIENT_MAX, SHOPPING_RULES.recipientTooLong)
        .refine((v) => !CONTROL.test(v), RULES.characters)
        .nullish(),
      name: z
        .string({ error: RULES.nameMissing })
        .trim()
        .min(1, RULES.nameMissing)
        .refine((v) => codePoints(v) <= NAME_MAX, RULES.nameTooLong)
        .refine((v) => !CONTROL.test(v), RULES.characters),
      description: z
        .string({ error: RULES.request })
        .refine((v) => codePoints(v) <= DESCRIPTION_MAX, SHOPPING_RULES.descriptionTooLong)
        .refine((v) => !CONTROL_EXCEPT_NOTES_WHITESPACE.test(v), RULES.characters)
        .nullish(),
      link: linkSchema.nullish(),
      price: z.number({ error: RULES.price }).min(0, RULES.price).max(PRICE_MAX, RULES.price).nullish(),
      imagePath: z.string({ error: INVALID_IMAGE_ERROR }).nullish(),
      occasion: z.string({ error: SHOPPING_RULES.chooseOccasion }).nullish(),
      notes: z
        .string({ error: RULES.request })
        .refine((v) => codePoints(v) <= NOTES_MAX, RULES.notesTooLong)
        .refine((v) => !CONTROL_EXCEPT_NOTES_WHITESPACE.test(v), RULES.characters)
        .nullish(),
    },
    { error: RULES.request },
  )
  // Exactly one of person and recipientName: a blank recipientName counts as not given.
  .refine((v) => (v.person != null) !== (v.recipientName != null && v.recipientName !== ""), SHOPPING_RULES.chooseWho);

export function parseGiftBody(raw: unknown): { ok: true; body: GiftBody } | { ok: false; message: string } {
  const result = giftBodySchema.safeParse(raw);
  if (!result.success) return { ok: false, message: result.error.issues[0]?.message ?? RULES.request };
  const v = result.data;
  return {
    ok: true,
    body: {
      person: v.person ?? null,
      recipientName: v.recipientName ? v.recipientName : null,
      name: v.name,
      description: v.description ?? null,
      link: v.link ? v.link : null,
      price: v.price ? v.price : null,
      imagePath: v.imagePath ?? null,
      occasion: v.occasion ?? null,
      notes: v.notes ?? null,
    },
  };
}

const EVERY_CONTROL = new RegExp(CONTROL.source, "g");
const EVERY_CONTROL_EXCEPT_NOTES_WHITESPACE = new RegExp(CONTROL_EXCEPT_NOTES_WHITESPACE.source, "g");

/**
 * What a gift filed from an item copies of it, fitted to the door's rules (parseGiftBody), which are within the
 * tracker's own checks: so a later save of the gift, of its notes alone, is never refused over a field the person did
 * not type. A link the door would refuse is dropped; control characters the door refuses are taken out; text is cut by
 * code points; a price out of the door's range is dropped.
 */
export function filedGiftValues(item: ClaimedItem): { name: string; description: string | null; link: string | null; price: number | null } {
  const link = item.url === null ? null : linkSchema.safeParse(item.url);
  return {
    name: cutTo(item.title.replace(EVERY_CONTROL, ""), NAME_MAX),
    description: item.description === null
      ? null
      : cutTo(item.description.replace(EVERY_CONTROL_EXCEPT_NOTES_WHITESPACE, ""), DESCRIPTION_MAX),
    link: link !== null && link.success && link.data !== "" ? link.data : null,
    price: item.price !== null && Number.isFinite(item.price) && item.price >= 0 && item.price <= PRICE_MAX ? item.price : null,
  };
}

const stepBodySchema = z.object(
  {
    direction: z.enum(["forward", "back"], { error: RULES.request }),
    from: z.enum(["claimed", "planned", "ordered", "arrived", "wrapped", "given"], { error: RULES.request }),
  },
  { error: RULES.request },
);

/** `from` is the stage the app saw the gift at: the step is made only if the gift is still there. */
export function parseStepBody(raw: unknown): { ok: true; direction: StepDirection; from: GiftStage } | { ok: false; message: string } {
  const result = stepBodySchema.safeParse(raw);
  if (!result.success) return { ok: false, message: RULES.request };
  return { ok: true, direction: result.data.direction, from: result.data.from };
}
