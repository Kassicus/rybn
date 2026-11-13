import { z } from "zod";
import { occasionInvolvesAny } from "@/lib/occasions/celebrant";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { itemsTaggedFor, partitionByOccasion } from "@/lib/occasions/order";
import type { Priority } from "@/lib/schemas/wishlist";
import {
  compareGifts,
  type GiftChoices,
  type GiftView,
  type MobileGift,
} from "./gifts";
import type { GroupRole } from "./groups";
import {
  byPersonName,
  homeOccasions,
  mobileOccasion,
  mobilePerson,
  occasionKey,
  occasionsInvolving,
  sharedGroupIds,
  shoppingPeople,
  type MobileOccasion,
  type MobilePerson,
  type PersonRow,
} from "./occasions";
import { SHOPPING_RULES } from "./shopping-rules";
import { RULES, mobileGroups, type GroupRow, type MobileGroup } from "./wishlist";

export interface ShoppingFor {
  person: MobilePerson;
  giftCount: number;
}
export interface ShoppingOccasion {
  occasion: MobileOccasion;
  people: ShoppingFor[];
  started: number;
  total: number;
}

/** §5.4: a gift counts toward the occasion it is filed under, and nowhere else. */
export function shoppingOccasion(o: UpcomingOccasion, people: PersonRow[], views: GiftView[]): ShoppingOccasion {
  const entries = people.map((p): ShoppingFor => ({
    person: mobilePerson(p),
    giftCount: views.filter((v) =>
      !v.archived && v.occasionId !== null && v.occasionId === o.occasionId && v.personId === p.id).length,
  }));
  return {
    occasion: mobileOccasion(o),
    people: entries,
    started: entries.filter((e) => e.giftCount > 0).length,
    total: entries.length,
  };
}

export function buildHome(input: {
  callerId: string;
  upcoming: UpcomingOccasion[];
  members: ReadonlyMap<string, PersonRow[]>;
  profiles: ReadonlyMap<string, PersonRow>;
  views: GiftView[];
}): { occasions: ShoppingOccasion[] } {
  return {
    occasions: homeOccasions(input.upcoming, input.callerId).map((o) =>
      shoppingOccasion(o, shoppingPeople(o, input.callerId, input.members, input.profiles), input.views)),
  };
}

export interface GroupSummary extends MobileGroup {
  memberCount: number;
}

export function buildGroupList(rows: GroupRow[], counts: ReadonlyMap<string, number>): { groups: GroupSummary[] } {
  return {
    groups: mobileGroups(rows).map((g) => ({ id: g.id, name: g.name, type: g.type, memberCount: counts.get(g.id) ?? 0 })),
  };
}

/** The group a group page is about: its description, and the caller's own role in it. */
export interface GroupPageGroup extends MobileGroup {
  description: string | null;
  role: GroupRole;
}
export interface GroupMember {
  person: MobilePerson;
  itemCount: number;
  hasGift: boolean;
  isYou: boolean;
  role: GroupRole;
}
/** An occasion on a group page, with the row id to change it by when it is a group date the caller may change. */
export interface GroupOccasion extends ShoppingOccasion {
  change: { id: string } | null;
}
export interface GroupPage {
  group: GroupPageGroup;
  members: GroupMember[];
  occasions: GroupOccasion[];
}

/**
 * A person the roles do not name is read as a member, the role that can do the least. A group date carries `change`
 * as the database decides who may change it: someone in the group who made it, or is an owner or admin of it. `makers`
 * holds who made each of the group's dates; one it does not name is changed by an owner or admin alone.
 */
export function buildGroupPage(input: {
  callerId: string;
  group: MobileGroup & { description: string | null };
  members: PersonRow[];
  roles: ReadonlyMap<string, GroupRole>;
  itemCounts: ReadonlyMap<string, number>;
  upcoming: UpcomingOccasion[];
  profiles: ReadonlyMap<string, PersonRow>;
  views: GiftView[];
  makers: ReadonlyMap<string, string | null>;
}): GroupPage {
  const { callerId, group, members, roles, views } = input;
  const memberIds = new Set(members.map((m) => m.id));
  const people = members
    .map((m) => ({ row: m, person: mobilePerson(m) }))
    .sort((a, b) => byPersonName(a.person, b.person));
  const byGroup = new Map<string, PersonRow[]>([[group.id, members]]);
  // undefined when the caller is not one of the group's members, who may change nothing
  const callerRole = roles.get(callerId);
  const change = (o: UpcomingOccasion): { id: string } | null => {
    if (o.kind !== "group_date" || o.occasionId === null || callerRole === undefined) return null;
    const allowed = callerRole === "owner" || callerRole === "admin" || input.makers.get(o.occasionId) === callerId;
    return allowed ? { id: o.occasionId } : null;
  };
  return {
    group: {
      id: group.id,
      name: group.name,
      type: group.type,
      description: group.description,
      role: roles.get(callerId) ?? "member",
    },
    members: people.map(({ row, person }) => ({
      person,
      itemCount: input.itemCounts.get(row.id) ?? 0,
      hasGift: row.id !== callerId && views.some((v) => !v.archived && v.personId === row.id && v.status !== "given"),
      isYou: row.id === callerId,
      role: roles.get(row.id) ?? "member",
    })),
    occasions: homeOccasions(input.upcoming, callerId)
      .filter((o) => (o.kind === "group_date" ? o.groupId === group.id : occasionInvolvesAny(o, memberIds)))
      .map((o) => ({
        ...shoppingOccasion(o, shoppingPeople(o, callerId, byGroup, input.profiles), views),
        change: change(o),
      })),
  };
}

/** getUserWishlist's rows as the caller sees them (image_url signed), with the columns these functions read. */
export interface ListItemRow {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  url: string | null;
  price: number | null;
  image_url: string | null;
  priority: Priority | null;
  purchased: boolean | null;
  out_of_stock_marked_by: string | null;
  created_at: string;
}

export type ItemState = "available" | "mine" | "taken";

export interface MobileListItem {
  id: string;
  title: string;
  description: string | null;
  url: string | null;
  price: number | null;
  imageUrl: string | null;
  priority: Priority;
  state: ItemState;
  outOfStock: boolean;
  tagged: boolean;
}

/** Never says who holds an item or who marked it out of stock; and says nothing at all on the caller's own list (§5.5). */
export function mobileListItem(
  row: ListItemRow,
  claim: { claimedBy: string } | undefined,
  callerId: string,
  tagged: boolean,
): MobileListItem {
  const own = row.user_id === callerId;
  let state: ItemState = "available";
  if (!own) {
    if (claim) state = claim.claimedBy === callerId ? "mine" : "taken";
    else if (row.purchased) state = "taken";
  }
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    url: row.url,
    price: row.price !== null && row.price > 0 ? row.price : null,
    imageUrl: row.image_url,
    priority: row.priority ?? "medium",
    state,
    outOfStock: !own && row.out_of_stock_marked_by !== null,
    tagged: !own && tagged,
  };
}

const PRIORITY_RANK: Record<Priority, number> = { "must-have": 0, high: 1, medium: 2, low: 3 };

/** By priority, then newest first; then the items tagged for the occasion in view, ahead of the rest. */
export function orderListRows<T extends ListItemRow>(rows: T[], taggedIds: ReadonlySet<string>): T[] {
  const sorted = [...rows].sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority ?? "medium"] - PRIORITY_RANK[b.priority ?? "medium"];
    if (byPriority !== 0) return byPriority;
    const byTime = Date.parse(b.created_at) - Date.parse(a.created_at);
    if (byTime !== 0 && !Number.isNaN(byTime)) return byTime;
    return a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0;
  });
  const { tagged, rest } = partitionByOccasion(sorted, new Set(taggedIds));
  return [...tagged, ...rest];
}

export interface PersonListAnswer {
  person: MobilePerson;
  occasion: MobileOccasion | null;
  occasions: MobileOccasion[];
  gifts: MobileGift[];
  items: MobileListItem[];
}

export function buildPersonList(input: {
  callerId: string;
  person: PersonRow;
  upcoming: UpcomingOccasion[];
  sharedGroupIds: ReadonlySet<string>;
  occasionKey: string | null;
  rows: ListItemRow[];
  claims: Record<string, { claimedBy: string }>;
  tags: Record<string, string[]>;
  views: GiftView[];
}): PersonListAnswer {
  const person = mobilePerson(input.person);
  if (input.person.id === input.callerId) {
    return {
      person,
      occasion: null,
      occasions: [],
      gifts: [],
      items: orderListRows(input.rows, new Set()).map((r) => mobileListItem(r, undefined, input.callerId, false)),
    };
  }
  const involved = occasionsInvolving(input.person.id, input.upcoming, input.sharedGroupIds);
  const inView = input.occasionKey === null ? null : involved.find((o) => occasionKey(o) === input.occasionKey) ?? null;
  const taggedIds = itemsTaggedFor(input.tags, inView?.occasionId ?? null);
  const filed = (v: GiftView) => inView !== null && inView.occasionId !== null && v.occasionId === inView.occasionId;
  const mine = input.views.filter((v) => v.personId === input.person.id && !v.archived && v.status !== "given");
  const ordered = [
    ...mine.filter(filed).map((v) => v.gift).sort(compareGifts),
    ...mine.filter((v) => !filed(v)).map((v) => v.gift).sort(compareGifts),
  ];
  return {
    person,
    occasion: inView ? mobileOccasion(inView) : null,
    occasions: involved.map(mobileOccasion),
    gifts: ordered,
    items: orderListRows(input.rows, taggedIds).map((r) =>
      mobileListItem(r, input.claims[r.id], input.callerId, taggedIds.has(r.id))),
  };
}

export function buildChoices(input: {
  callerId: string;
  upcoming: UpcomingOccasion[];
  members: ReadonlyMap<string, PersonRow[]>;
}): GiftChoices {
  const everyone = new Map<string, PersonRow>();
  for (const people of input.members.values()) {
    for (const p of people) if (p.id !== input.callerId && !everyone.has(p.id)) everyone.set(p.id, p);
  }
  const people = [...everyone.values()]
    .map((p) => ({
      person: mobilePerson(p),
      occasions: occasionsInvolving(p.id, input.upcoming, sharedGroupIds(p.id, input.members)).map(mobileOccasion),
    }))
    .sort((a, b) => byPersonName(a.person, b.person));
  return {
    people,
    groupDates: input.upcoming.filter((o) => o.kind === "group_date").map(mobileOccasion),
  };
}

export interface ClaimBody {
  occasion: string | null;
}

const claimBodySchema = z.object(
  { occasion: z.string({ error: SHOPPING_RULES.chooseOccasion }).nullable() },
  { error: RULES.request },
);

export function parseClaimBody(raw: unknown): { ok: true; body: ClaimBody } | { ok: false; message: string } {
  const result = claimBodySchema.safeParse(raw);
  if (!result.success) return { ok: false, message: result.error.issues[0]?.message ?? RULES.request };
  return { ok: true, body: { occasion: result.data.occasion } };
}

/** The sentence for what claim_wishlist_item() refused with. */
export function claimRefusal(databaseMessage: string): string {
  const m = databaseMessage.toLowerCase();
  if (m.includes("that item is not available to claim")) return SHOPPING_RULES.notAvailable;
  if (m.includes("you cannot claim your own item")) return SHOPPING_RULES.ownItem;
  if (m.includes("that item has already been purchased")) return SHOPPING_RULES.alreadyBought;
  if (m.includes("somebody has already claimed that item")) return SHOPPING_RULES.alreadyClaimed;
  if (m.includes("that occasion is not available")) return SHOPPING_RULES.chooseOccasion;
  return SHOPPING_RULES.notAvailable;
}
