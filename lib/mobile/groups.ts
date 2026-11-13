import { z } from "zod";
import { GROUP_RULES, GROUP_SENTENCES } from "@/lib/groups/sentences";
import { GROUP_DATE_RULES, GROUP_DATE_SENTENCES } from "@/lib/occasions/sentences";
import { createGroupSchema } from "@/lib/schemas/groups";
import { tidyGroupText } from "@/lib/utils/groups";
import type { GroupType } from "@/types/privacy";
import type { ActionAnswers } from "./action-response";
import { mobileOccasion, type MobileOccasion } from "./occasions";
import { RULES } from "./wishlist";

/** A person's place in a group, as group_members stores it. */
export type GroupRole = "owner" | "admin" | "member";

/** "owner" and "admin" as they are; anything else is read as "member", which can do the least. */
export function groupRole(value: unknown): GroupRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/**
 * For each group route, the sentences of the action it calls that it passes on (actionAnswer): `notFound` as 404, as
 * for a group the caller cannot see, and `refusals` as 422 with the website's words. Each is the action's own sentence,
 * from lib/groups/sentences.ts. Any other answer is a fault.
 */
export const GROUP_ROUTE_ANSWERS = {
  // createGroup's refusals are its schema's: the same sentences the door answers.
  create: { refusals: Object.values(GROUP_RULES) },
  join: {
    refusals: [GROUP_SENTENCES.invalidCode, GROUP_SENTENCES.alreadyMember, GROUP_SENTENCES.stillSettingUp],
  },
  invitation: {
    notFound: [GROUP_SENTENCES.notAMember],
    refusals: [
      GROUP_RULES.email,
      GROUP_SENTENCES.hourlyLimit,
      GROUP_SENTENCES.alreadyInGroup,
      GROUP_SENTENCES.alreadyInvited,
    ],
  },
  leave: { notFound: [GROUP_SENTENCES.notAMember], refusals: [GROUP_SENTENCES.ownerCannotLeave] },
  delete: { refusals: [GROUP_SENTENCES.onlyOwnerDeletes] },
} as const satisfies Record<string, ActionAnswers>;

const DATE_REFUSALS = [GROUP_DATE_RULES.name, GROUP_DATE_RULES.nameTooLong, GROUP_DATE_RULES.date] as const;

/**
 * As GROUP_ROUTE_ANSWERS, for the group date routes and the actions they call (lib/actions/occasions.ts), whose
 * sentences are in lib/occasions/sentences.ts. A date the caller may not change answers 404, as one that is not there
 * does: the actions answer both with one sentence, on purpose.
 */
export const GROUP_DATE_ROUTE_ANSWERS = {
  add: { notFound: [GROUP_SENTENCES.notAMember], refusals: DATE_REFUSALS },
  save: { notFound: [GROUP_DATE_SENTENCES.notYoursToEdit], refusals: DATE_REFUSALS },
  delete: { notFound: [GROUP_DATE_SENTENCES.notYoursToDelete] },
} as const satisfies Record<string, ActionAnswers>;

export interface NewGroupBody {
  name: string;
  description: string | null;
  type: GroupType;
}

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * The longest group name, group description or group date name, in UTF-16 code units, that the door passes on to be
 * tidied (tidyGroupText): far beyond the 50 or 200 the schema allows once tidied. A longer one is refused first, with
 * the field's own too-long sentence.
 */
const TEXT_MAX = 2000;

const tooLong = (value: unknown): boolean => typeof value === "string" && value.length > TEXT_MAX;

/**
 * A new group's name, description and kind, checked with the website's own create schema. A body that is not an object
 * is refused with the plain sentence; a name or a description longer than 2000 UTF-16 code units, before any tidying,
 * with its own too-long sentence; a description sent as null, or not sent, is none. Every other refusal is the
 * schema's first sentence (GROUP_RULES). Nothing else in the body is read.
 */
export function parseNewGroupBody(raw: unknown): { ok: true; body: NewGroupBody } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: RULES.request };
  if (tooLong(raw.name)) return { ok: false, message: GROUP_RULES.nameTooLong };
  if (tooLong(raw.description)) return { ok: false, message: GROUP_RULES.descriptionTooLong };
  const result = createGroupSchema.safeParse({
    name: raw.name,
    description: raw.description ?? undefined,
    type: raw.type,
  });
  if (!result.success) return { ok: false, message: result.error.issues[0]?.message ?? RULES.request };
  const { name, description, type } = result.data;
  return { ok: true, body: { name, description: description ?? null, type } };
}

/** The longest code the door passes on: well beyond a code with spaces in, tidied by joinGroupByCode. */
const CODE_MAX = 64;
/** The longest address, once trimmed, that sendGroupInvitation takes (invitationEmailSchema). */
const EMAIL_MAX = 254;

const joinBodySchema = z.object({ code: z.string().max(CODE_MAX) });

/**
 * The code as the app sent it: joinGroupByCode tidies it. A body without a code, or with one longer than 64
 * characters, is refused as a bad code is, before the action.
 */
export function parseJoinBody(raw: unknown): { ok: true; code: string } | { ok: false; message: string } {
  const result = joinBodySchema.safeParse(raw);
  return result.success ? { ok: true, code: result.data.code } : { ok: false, message: GROUP_SENTENCES.invalidCode };
}

const invitationBodySchema = z.object({ email: z.string().refine((email) => email.trim().length <= EMAIL_MAX) });

/**
 * The address as the app sent it: sendGroupInvitation trims and checks it. A body without one, or with one longer
 * than 254 characters once trimmed, is refused as a bad one is, before the action. A space after an address, as a
 * phone's keyboard adds, is the action's to trim, so it never counts toward the length.
 */
export function parseInvitationBody(raw: unknown): { ok: true; email: string } | { ok: false; message: string } {
  const result = invitationBodySchema.safeParse(raw);
  return result.success ? { ok: true, email: result.data.email } : { ok: false, message: GROUP_RULES.email };
}

export interface InvitationAnswer {
  sent: boolean;
  resent: boolean;
  message: string;
}

/**
 * What the app is told about an invitation, field by field: whether the email went, whether it was sent again, and the
 * website's sentence for it. The action's warning when the email could not be sent; otherwise its sent or resent words.
 */
export function invitationAnswer(result: { emailSent: boolean; isResend: boolean; warning?: string }): InvitationAnswer {
  const words = result.isResend ? GROUP_SENTENCES.invitationResent : GROUP_SENTENCES.invitationSent;
  return {
    sent: result.emailSent === true,
    resent: result.isResend === true,
    message: typeof result.warning === "string" && result.warning !== "" ? result.warning : words,
  };
}

/**
 * A group date's name and date as the app sent them: createGroupDate and updateGroupDate tidy the name (tidyGroupText)
 * and check both (GROUP_DATE_RULES). A body that is not an object is refused with the plain sentence, one whose name or date is
 * not text with the action's sentence for it, and one whose name is longer than 2000 UTF-16 code units, before any
 * tidying, with the name's too-long sentence, all before the action. Nothing else in the body is read.
 */
export function parseGroupDateBody(raw: unknown): { ok: true; name: string; date: string } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: RULES.request };
  if (typeof raw.name !== "string") return { ok: false, message: GROUP_DATE_RULES.name };
  if (tooLong(raw.name)) return { ok: false, message: GROUP_DATE_RULES.nameTooLong };
  if (typeof raw.date !== "string") return { ok: false, message: GROUP_DATE_RULES.date };
  return { ok: true, name: raw.name, date: raw.date };
}

/**
 * The occasion a group date the action has just saved is, as GET /groups/{id} sends it: its name on one line and
 * trimmed (tidyGroupText), as the action stores it.
 */
export function groupDateOccasion(id: string, name: string, date: string, group: { id: string; name: string }): MobileOccasion {
  return mobileOccasion({
    occasionId: id,
    kind: "group_date",
    name: tidyGroupText(name),
    occasionDate: date,
    celebrantId: null,
    celebrantUsername: null,
    celebrantDisplayName: null,
    groupId: group.id,
    groupName: group.name,
    partnerId: null,
    partnerUsername: null,
    partnerDisplayName: null,
  });
}
