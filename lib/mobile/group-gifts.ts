import type { MyGroupGift, SeenGroupGift } from "@/lib/actions/gifts";
import type { GiftPerson } from "@/lib/gifts/access";
import { GIFT_LIMITS, GIFT_SENTENCES } from "@/lib/gifts/sentences";
import { CONTROL_EXCEPT_NOTES_WHITESPACE } from "@/lib/utils/characters";
import { tidyGroupText } from "@/lib/utils/groups";
import type { ActionAnswers } from "./action-response";
import { PERSON_ID, pathUuid } from "./database";
import { byPersonName, mobilePerson, type MobilePerson } from "./occasions";
import { RULES } from "./wishlist";

/** A gift as the list shows it. Named fields only, in the contract's order. */
export interface MobileGroupGiftSummary {
  id: string;
  name: string;
  description: string | null;
  /** Null when the caller is not in the gift's group. */
  groupName: string | null;
  /** Who the gift is for, in the order the action answers them; empty when it names no one. */
  recipients: MobilePerson[];
  targetAmount: number | null;
  /** The sum of every pledge. */
  pledged: number;
  memberCount: number;
  myPledge: number;
  myPaid: boolean;
  isMaker: boolean;
  active: boolean;
}

/** A gift as its page shows it. */
export interface MobileGroupGift extends MobileGroupGiftSummary {
  members: { person: MobilePerson; pledge: number; paid: boolean; isYou: boolean }[];
  chat: { count: number; latest: { name: string; text: string } | null };
  canAddPeople: boolean;
  canDelete: boolean;
}

/** An amount of money in whole cents; nothing, undefined and NaN (or any other number that is not finite) are 0. */
export function money(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** What the list and a gift's page share, field by field. */
function summaryFields(
  gift: MyGroupGift | SeenGroupGift,
  memberCount: number,
  mine: { contribution_amount: number | null; has_paid: boolean | null },
  callerId: string,
): MobileGroupGiftSummary {
  return {
    id: gift.id,
    name: gift.name,
    description: gift.description,
    groupName: gift.group_name,
    recipients: gift.recipients.map(mobilePerson),
    targetAmount: gift.target_amount === null ? null : money(gift.target_amount),
    pledged: money(gift.current_amount),
    memberCount,
    myPledge: money(mine.contribution_amount),
    myPaid: mine.has_paid === true,
    isMaker: gift.created_by === callerId,
    active: gift.is_active === true,
  };
}

export function groupGiftSummary(gift: MyGroupGift, callerId: string): MobileGroupGiftSummary {
  return summaryFields(
    gift,
    gift.member_count,
    { contribution_amount: gift.my_contribution, has_paid: gift.my_has_paid },
    callerId,
  );
}

/** A member whose profile cannot be read is a person of their id alone, named "Someone". */
function memberPerson(id: string, profile: GiftPerson | null): MobilePerson {
  return mobilePerson(profile ?? { id, username: null, display_name: null, avatar_url: null });
}

export function groupGiftPage(gift: SeenGroupGift, callerId: string): MobileGroupGift {
  const isMaker = gift.created_by === callerId;
  const latest = gift.chat.latest;
  return {
    ...summaryFields(gift, gift.group_gift_members.length, gift.my_membership, callerId),
    members: gift.group_gift_members.map((m) => ({
      person: memberPerson(m.user_id, m.user_profiles),
      pledge: money(m.contribution_amount),
      paid: m.has_paid === true,
      isYou: m.user_id === callerId,
    })),
    chat: {
      count: gift.chat.count,
      latest: latest === null ? null : { name: latest.name, text: latest.text },
    },
    canAddPeople: isMaker,
    canDelete: isMaker,
  };
}

/** The caller's groups and the people they share one with, each person by name with the caller's groups they are in. */
export function giftChoices(data: {
  groups: { id: string; name: string }[];
  people: (GiftPerson & { group_ids: string[] })[];
}): { groups: { id: string; name: string }[]; people: { person: MobilePerson; groupIds: string[] }[] } {
  return {
    groups: data.groups.map((g) => ({ id: g.id, name: g.name })),
    people: data.people
      .map((p) => ({ person: mobilePerson(p), groupIds: [...p.group_ids] }))
      .sort((a, b) => byPersonName(a.person, b.person)),
  };
}

/**
 * For each group gift route, the sentences of the action it calls that it passes on (actionAnswer): `notFound` as 404,
 * the same answer for a gift that is not there, one the caller is not in and one that names them, and `refusals` as 422
 * with the website's words. Each is the action's own sentence, from lib/gifts/sentences.ts. Any other answer is a fault.
 */
export const GROUP_GIFT_ROUTE_ANSWERS = {
  create: {
    refusals: [
      GIFT_SENTENCES.chooseWho,
      GIFT_SENTENCES.recipientNotAllowed,
      GIFT_SENTENCES.tooManyRecipients,
      GIFT_SENTENCES.notInGroup,
      GIFT_SENTENCES.nameMissing,
      GIFT_SENTENCES.nameTooLong,
      GIFT_SENTENCES.descriptionTooLong,
      GIFT_SENTENCES.amount,
      GIFT_SENTENCES.characters,
    ],
  },
  one: { notFound: [GIFT_SENTENCES.notThere] },
  delete: { notFound: [GIFT_SENTENCES.notThere], refusals: [GIFT_SENTENCES.onlyMakerDeletes] },
  pledge: { notFound: [GIFT_SENTENCES.notThere], refusals: [GIFT_SENTENCES.amount] },
  people: { notFound: [GIFT_SENTENCES.notThere], refusals: [GIFT_SENTENCES.onlyMakerAdds] },
  add: {
    notFound: [GIFT_SENTENCES.notThere],
    refusals: [GIFT_SENTENCES.onlyMakerAdds, GIFT_SENTENCES.cannotAdd],
  },
  messages: { notFound: [GIFT_SENTENCES.notThere] },
  send: {
    notFound: [GIFT_SENTENCES.notThere],
    refusals: [GIFT_SENTENCES.messageMissing, GIFT_SENTENCES.messageTooLong, GIFT_SENTENCES.characters],
  },
} as const satisfies Record<string, ActionAnswers>;

export interface NewGroupGiftBody {
  groupId: string;
  recipientIds: string[];
  name: string;
  description: string | null;
  targetAmount: number | null;
}

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * A pledge's body: `amount` a finite number from 0 to 1,000,000, else the amount sentence; `paid` a boolean, else
 * `That request wasn't valid.`, which is also the answer for a body that is not an object. The amount is read first,
 * as the action does. Nothing else in the body is read.
 */
export function parsePledgeBody(
  raw: unknown,
): { ok: true; amount: number; paid: boolean } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: RULES.request };
  const { amount, paid } = raw;
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0 || amount > GIFT_LIMITS.amount) {
    return { ok: false, message: GIFT_SENTENCES.amount };
  }
  if (typeof paid !== "boolean") return { ok: false, message: RULES.request };
  return { ok: true, amount, paid };
}

/** The most people one request can add. */
const MOST_ADDED = 50;

/**
 * The body that adds people to a gift: `ids` is a list of 1 to 50 person ids, a repeated id counting once. A list
 * that is empty, too long, or holds anything that is not a person's id answers the one cannot-add sentence, the same
 * whichever way it fails. A body of any other shape answers `That request wasn't valid.`.
 */
export function parseAddPeopleBody(raw: unknown): { ok: true; ids: string[] } | { ok: false; message: string } {
  if (!isRecord(raw) || !Array.isArray(raw.ids)) return { ok: false, message: RULES.request };
  const asked = [...new Set<unknown>(raw.ids)];
  const ids = asked.filter((id): id is string => typeof id === "string" && PERSON_ID.test(id));
  if (ids.length === 0 || ids.length !== asked.length || ids.length > MOST_ADDED) {
    return { ok: false, message: GIFT_SENTENCES.cannotAdd };
  }
  return { ok: true, ids };
}

/**
 * A new group gift's body, checked with the rules the action checks again, in the action's order, so one body gets one
 * sentence at the door and in the action. A body that is not an object, and a description that is neither text nor
 * null, answer `That request wasn't valid.`. The name is tidied (tidyGroupText) and the description trimmed; a blank
 * description is none, and a target of null or none is none. `recipientIds` is a list of at most 20 distinct person
 * ids, which may be empty; a repeated id counts once. Nothing else in the body is read.
 */
export function parseNewGroupGiftBody(
  raw: unknown,
): { ok: true; body: NewGroupGiftBody } | { ok: false; message: string } {
  const refuse = (message: string) => ({ ok: false as const, message });
  if (!isRecord(raw)) return refuse(RULES.request);
  if (!Array.isArray(raw.recipientIds)) return refuse(GIFT_SENTENCES.chooseWho);

  // A name's control characters are spaces once tidied, so only its length can be wrong.
  const name = typeof raw.name === "string" ? tidyGroupText(raw.name) : "";
  if (name === "") return refuse(GIFT_SENTENCES.nameMissing);
  if (name.length > GIFT_LIMITS.name) return refuse(GIFT_SENTENCES.nameTooLong);

  if (raw.description != null && typeof raw.description !== "string") return refuse(RULES.request);
  const description = raw.description == null ? "" : raw.description.trim();
  if (description.length > GIFT_LIMITS.description) return refuse(GIFT_SENTENCES.descriptionTooLong);
  if (CONTROL_EXCEPT_NOTES_WHITESPACE.test(description)) return refuse(GIFT_SENTENCES.characters);

  const target: unknown = raw.targetAmount;
  if (
    target != null &&
    !(typeof target === "number" && Number.isFinite(target) && target >= 0 && target <= GIFT_LIMITS.amount)
  ) {
    return refuse(GIFT_SENTENCES.amount);
  }

  const asked = [...new Set<unknown>(raw.recipientIds)];
  if (asked.length > GIFT_LIMITS.recipients) return refuse(GIFT_SENTENCES.tooManyRecipients);

  const groupId = typeof raw.groupId === "string" ? pathUuid(raw.groupId) : null;
  if (groupId === null) return refuse(GIFT_SENTENCES.notInGroup);

  const recipientIds = asked.filter((id): id is string => typeof id === "string" && PERSON_ID.test(id));
  if (recipientIds.length !== asked.length) return refuse(GIFT_SENTENCES.recipientNotAllowed);

  return {
    ok: true,
    body: {
      groupId,
      recipientIds,
      name,
      description: description === "" ? null : description,
      targetAmount: typeof target === "number" ? target : null,
    },
  };
}
