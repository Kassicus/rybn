import { z } from "zod";
import { isOccasionFor, occasionCelebrantIds } from "@/lib/occasions/celebrant";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { resolveTagTarget, taggableOccasions, type TagTarget } from "@/lib/occasions/taggable";
import {
  ALL_GROUP_TYPES,
  describeChoice,
  fromStored,
  toStored,
  type PrivacyChoice,
  type StoredPrivacy,
} from "@/lib/wishlist/privacy-choice";
import { priorityLevels, type Priority, type WishlistItemFormData } from "@/lib/schemas/wishlist";
import { INVALID_IMAGE_ERROR } from "@/lib/storage/image-value";
import type { GroupType } from "@/types/privacy";
import {
  mobileOccasion,
  occasionFromRow,
  occasionKey,
  type MobileOccasion,
  type OccasionRow,
  type PersonRow,
} from "./occasions";

/** Every sentence the rules at the door can answer with. */
export const RULES = {
  request: "That request wasn't valid.",
  nameMissing: "Give it a name.",
  nameTooLong: "Keep the name to 200 characters or fewer.",
  notesTooLong: "Keep the notes to 1000 characters or fewer.",
  categoryTooLong: "Keep the category to 50 characters or fewer.",
  linkNotWeb: "Links must start with http:// or https://.",
  linkTooLong: "That link is too long.",
  price: "Enter a price above zero, or leave it empty.",
  priority: "Choose how much you want it.",
  privacy: "Choose who can see it.",
  chooseGroup: "Choose one of your groups.",
  characters: "That has characters Rybn can't save. Try typing it again.",
  chooseDate: "Choose one of your dates.",
  tooManyDates: "Add 20 dates or fewer at a time.",
} as const;

/** Control characters: U+0000 to U+001F and U+007F. */
export const CONTROL = /[\u0000-\u001F\u007F]/;
/** Control characters other than tab, line feed and carriage return, which notes may hold. */
export const CONTROL_EXCEPT_NOTES_WHITESPACE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
/** Whitespace or a control character. */
export const SPACE_OR_CONTROL = /[\s\u0000-\u001F\u007F]/;

export interface MobileGroup {
  id: string;
  name: string;
  type: GroupType;
}

export interface MobileItem {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  price: number | null;
  imageUrl: string | null;
  imagePath: string | null;
  priority: Priority;
  category: string | null;
  privacy: PrivacyChoice;
  privacySummary: string;
  createdAt: string;
  /** Every occasion the item is tagged for that the caller can see, soonest first. */
  occasions: MobileOccasion[];
}

/** The columns mobileItem reads. Rows carry more (purchased, user_id, …); none of it is sent. */
export interface WishlistItemRow {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  price: number | null;
  image_url: string | null;
  image_path: string | null;
  priority: Priority | null;
  category: string | null;
  privacy_settings: unknown;
  created_at: string;
}

/** What getMyGroups returns per membership: the group's columns spread, or nothing when RLS hid the group. */
export type GroupRow = { id?: string | null; name?: string | null; type?: GroupType | null } & Record<string, unknown>;

export interface WishlistBody {
  title: string;
  description: string | null;
  url: string | null;
  price: number | null;
  imagePath: string | null;
  priority: Priority;
  category: string | null;
  privacy: PrivacyChoice;
  /** The occasion keys the item is to be tagged for, each once. Null when the body had none: its tags are left alone. */
  occasions: string[] | null;
}

/** ISO 8601, UTC, whole seconds. The fraction is dropped, never rounded up. */
export function utcSeconds(timestamp: string): string {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A privacy_settings value that is not an object reads as private: it fails closed. */
function readStoredPrivacy(value: unknown): StoredPrivacy {
  if (typeof value !== "object" || value === null) {
    return { visibleToGroupTypes: [], restrictToGroup: null };
  }
  const { visibleToGroupTypes, restrictToGroup } = value as Record<string, unknown>;
  // A restrictToGroup that is present but neither null nor text cannot be trusted: read it as private.
  if (restrictToGroup !== undefined && restrictToGroup !== null && typeof restrictToGroup !== "string") {
    return { visibleToGroupTypes: [], restrictToGroup: null };
  }
  return {
    visibleToGroupTypes: Array.isArray(visibleToGroupTypes) ? (visibleToGroupTypes as GroupType[]) : [],
    restrictToGroup: typeof restrictToGroup === "string" ? restrictToGroup : null,
  };
}

export function mobileItem(row: WishlistItemRow, groups: MobileGroup[], occasions: MobileOccasion[]): MobileItem {
  const privacy = fromStored(readStoredPrivacy(row.privacy_settings));
  const groupName =
    privacy.kind === "group" ? (groups.find((g) => g.id === privacy.groupId)?.name ?? null) : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    price: row.price !== null && row.price > 0 ? row.price : null,
    imageUrl: row.image_url,
    imagePath: row.image_path,
    priority: row.priority ?? "medium",
    category: row.category,
    privacy,
    privacySummary: describeChoice(privacy, groupName),
    createdAt: utcSeconds(row.created_at),
    occasions,
  };
}

export function mobileGroups(rows: GroupRow[]): MobileGroup[] {
  const groups: MobileGroup[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || row.id === "" || typeof row.name !== "string" || row.name === "") continue;
    groups.push({ id: row.id, name: row.name, type: row.type ?? "custom" });
  }
  return groups.sort((a, b) => a.name.localeCompare(b.name, "en"));
}

export function isWebLink(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const privacySchema = z.discriminatedUnion(
  "kind",
  [
    z.object({ kind: z.literal("groups") }),
    z.object({
      kind: z.literal("group"),
      groupId: z.string({ error: RULES.chooseGroup }).min(1, RULES.chooseGroup),
    }),
    z.object({ kind: z.literal("private") }),
    z.object({
      kind: z.literal("legacyTypes"),
      types: z
        .array(z.enum(ALL_GROUP_TYPES as [GroupType, ...GroupType[]], { error: RULES.privacy }), { error: RULES.privacy })
        .min(1, RULES.privacy),
    }),
  ],
  { error: RULES.privacy },
);

const bodySchema = z.object(
  {
    title: z
      .string({ error: RULES.nameMissing })
      .trim()
      .min(1, RULES.nameMissing)
      .max(200, RULES.nameTooLong)
      .refine((v) => !CONTROL.test(v), RULES.characters),
    description: z
      .string({ error: RULES.request })
      .max(1000, RULES.notesTooLong)
      .refine((v) => !CONTROL_EXCEPT_NOTES_WHITESPACE.test(v), RULES.characters)
      .nullish(),
    category: z
      .string({ error: RULES.request })
      .max(50, RULES.categoryTooLong)
      .refine((v) => !CONTROL.test(v), RULES.characters)
      .nullish(),
    url: z
      .string({ error: RULES.linkNotWeb })
      .trim()
      .max(2048, RULES.linkTooLong)
      .refine((v) => !SPACE_OR_CONTROL.test(v), RULES.characters)
      .refine((v) => v === "" || isWebLink(v), RULES.linkNotWeb)
      .nullish(),
    price: z.number({ error: RULES.price }).min(0, RULES.price).max(1000000, RULES.price).nullish(),
    imagePath: z.string({ error: INVALID_IMAGE_ERROR }).nullish(),
    priority: z.enum(priorityLevels, { error: RULES.priority }),
    privacy: privacySchema,
    // A bound on the body's size only. How many of these may be new to the item is decided against it (planTags).
    occasions: z
      .array(
        z
          .string({ error: RULES.chooseDate })
          .min(1, RULES.chooseDate)
          .max(200, RULES.chooseDate)
          .refine((v) => !CONTROL.test(v), RULES.chooseDate),
        { error: RULES.request },
      )
      .max(200, RULES.request)
      .nullish(),
  },
  { error: RULES.request },
);

export function parseWishlistBody(
  raw: unknown,
): { ok: true; body: WishlistBody } | { ok: false; message: string } {
  const result = bodySchema.safeParse(raw);
  if (!result.success) {
    return { ok: false, message: result.error.issues[0]?.message ?? RULES.request };
  }
  const v = result.data;
  return {
    ok: true,
    body: {
      title: v.title,
      description: v.description ?? null,
      url: v.url ? v.url : null,
      price: v.price ? v.price : null,
      imagePath: v.imagePath ?? null,
      priority: v.priority,
      category: v.category ?? null,
      privacy: v.privacy,
      occasions: v.occasions == null ? null : [...new Set(v.occasions)],
    },
  };
}

/** What createWishlistItem takes. The picture path travels in image_url, as it does on the site. */
export function formDataFromBody(body: WishlistBody): WishlistItemFormData {
  const stored = toStored(body.privacy);
  return {
    title: body.title,
    description: body.description,
    url: body.url,
    price: body.price,
    image_url: body.imagePath,
    priority: body.priority,
    category: body.category,
    visible_to_group_types: stored.visibleToGroupTypes,
    restrict_to_group: stored.restrictToGroup,
  };
}

/** On the caller's own list their own birthday or anniversary is theirs; any other occasion keeps the website's title. */
export function wishlistOccasion(o: UpcomingOccasion, callerId: string): MobileOccasion {
  const occasion = mobileOccasion(o);
  if (o.kind === "group_date" || !isOccasionFor(o, callerId)) return occasion;
  return { ...occasion, title: o.kind === "birthday" ? "Your birthday" : "Your anniversary" };
}

const ordinal = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Soonest first, and on the same day by key, so the order never rests on the database's. */
export function bySoonest(a: MobileOccasion, b: MobileOccasion): number {
  return ordinal(a.date, b.date) || ordinal(a.key, b.key);
}

/** What the caller may tag one of their items for now: the website's own rule (taggableOccasions), soonest first. */
export function tagChoices(upcoming: UpcomingOccasion[], callerId: string): UpcomingOccasion[] {
  return [...taggableOccasions(upcoming, callerId)].sort(
    (a, b) => ordinal(a.occasionDate, b.occasionDate) || ordinal(occasionKey(a), occasionKey(b)));
}

/** A tag on one of the caller's items: the occasion's row, and the occasion as the app is told it. */
export interface Tag {
  occasionId: string;
  occasion: MobileOccasion;
}

/** The occasions these items are tagged for that are not among the choices (they have passed): read from their rows. */
export function rowsToRead(tagged: Record<string, string[]>, choices: UpcomingOccasion[]): string[] {
  const offered = new Set(choices.map((o) => o.occasionId));
  return [...new Set(Object.values(tagged).flat())].filter((id) => !offered.has(id));
}

/** The people whose names title these rows: those of a birthday or anniversary that is not the caller's own. */
export function namesToRead(rows: OccasionRow[], callerId: string): string[] {
  const ids = rows.flatMap((r) => {
    const people = { celebrantId: r.celebrant_id, partnerId: r.partner_id };
    return r.kind === "group_date" || isOccasionFor(people, callerId) ? [] : occasionCelebrantIds(people);
  });
  return [...new Set(ids)];
}

/**
 * Each tagged item's tags, soonest first. An occasion among the choices is told as it is offered; any other (one that
 * has passed) from its row. A tag whose row the caller cannot read, such as a date of a group they have left, cannot be
 * named, so it is left out.
 */
export function itemTags(
  tagged: Record<string, string[]>,
  choices: UpcomingOccasion[],
  rows: OccasionRow[],
  names: ReadonlyMap<string, PersonRow>,
  callerId: string,
): Map<string, Tag[]> {
  const known = new Map<string, MobileOccasion>();
  for (const row of rows) known.set(row.id, wishlistOccasion(occasionFromRow(row, names), callerId));
  for (const o of choices) if (o.occasionId !== null) known.set(o.occasionId, wishlistOccasion(o, callerId));
  const tags = new Map<string, Tag[]>();
  for (const [itemId, ids] of Object.entries(tagged)) {
    const found = ids.flatMap((occasionId) => {
      const occasion = known.get(occasionId);
      return occasion ? [{ occasionId, occasion }] : [];
    });
    tags.set(itemId, found.sort((a, b) => bySoonest(a.occasion, b.occasion)));
  }
  return tags;
}

/** What a save changes: the choices to tag the item for, each with the action that tags it, and the tags to remove. */
export interface TagPlan {
  add: { occasion: UpcomingOccasion; target: TagTarget }[];
  remove: Tag[];
}

/** How many dates one save may add to an item. The tags it already has, however many, are not counted. */
export const MAX_NEW_DATES = 20;

/**
 * What saving `keys` asks of an item tagged `current`. A key it is tagged for already is kept, even one that has passed;
 * any other must be one of the choices, and at most MAX_NEW_DATES of them. Otherwise the sentence to refuse with, and
 * then nothing may be written. Only tags in `current`, the ones the app is shown, are ever removed.
 */
export function planTags(
  keys: string[],
  current: Tag[],
  choices: UpcomingOccasion[],
): { ok: true; plan: TagPlan } | { ok: false; message: string } {
  const wanted = new Set(keys);
  const tagged = new Set(current.map((t) => t.occasion.key));
  const add: TagPlan["add"] = [];
  for (const key of wanted) {
    if (tagged.has(key)) continue;
    const occasion = choices.find((o) => occasionKey(o) === key);
    const target = occasion ? resolveTagTarget(occasion) : null;
    if (!occasion || !target) return { ok: false, message: RULES.chooseDate };
    add.push({ occasion, target });
  }
  if (add.length > MAX_NEW_DATES) return { ok: false, message: RULES.tooManyDates };
  return { ok: true, plan: { add, remove: current.filter((t) => !wanted.has(t.occasion.key)) } };
}

/** True unless the choice names one group and that group is not among the caller's. */
export function isOneOfMyGroups(privacy: PrivacyChoice, groups: MobileGroup[]): boolean {
  return privacy.kind !== "group" || groups.some((g) => g.id === privacy.groupId);
}
