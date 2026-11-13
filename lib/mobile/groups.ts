import { z } from "zod";
import { GROUP_RULES, createGroupSchema } from "@/lib/schemas/groups";
import type { GroupType } from "@/types/privacy";
import { RULES } from "./wishlist";

/** A person's place in a group, as group_members stores it. */
export type GroupRole = "owner" | "admin" | "member";

/** "owner" and "admin" as they are; anything else is read as "member", which can do the least. */
export function groupRole(value: unknown): GroupRole {
  return value === "owner" || value === "admin" ? value : "member";
}

/** What the website's invite dialog says once an invitation is sent, or sent again. */
export const INVITATION_WORDS = {
  sent: "Invitation sent successfully!",
  resent: "Invitation resent successfully!",
} as const;

/**
 * The refusals of the group and invitation actions that the person can act on, as the actions answer them
 * (lib/actions/groups.ts, lib/actions/invitations.ts). The routes pass these on as 422 with the same words.
 */
export const GROUP_REFUSALS = {
  invalidCode: "Invalid invite code",
  alreadyMember: "You are already a member of this group",
  stillSettingUp: "Your account is still being set up. Please try again.",
  hourlyLimit: "Rate limit exceeded. You can send up to 10 invitations per hour. Please try again later.",
  alreadyInGroup: "This user is already a member of the group",
  ownerCannotLeave: "Owners cannot leave the group. Transfer ownership or delete the group.",
  onlyOwnerDeletes: "Only the owner can delete this group",
} as const;

export interface NewGroupBody {
  name: string;
  description: string | null;
  type: GroupType;
}

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

/**
 * A new group's name, description and kind, checked with the website's own create schema. A body that is not an object
 * is refused with the plain sentence; a description sent as null, or not sent, is none. Every other refusal is the
 * schema's first sentence (GROUP_RULES). Nothing else in the body is read.
 */
export function parseNewGroupBody(raw: unknown): { ok: true; body: NewGroupBody } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: RULES.request };
  const result = createGroupSchema.safeParse({
    name: raw.name,
    description: raw.description ?? undefined,
    type: raw.type,
  });
  if (!result.success) return { ok: false, message: result.error.issues[0]?.message ?? RULES.request };
  const { name, description, type } = result.data;
  return { ok: true, body: { name, description: description ?? null, type } };
}

const joinBodySchema = z.object({ code: z.string() });

/** The code as the app sent it: joinGroupByCode tidies it. A body without a code is refused as a bad code is. */
export function parseJoinBody(raw: unknown): { ok: true; code: string } | { ok: false; message: string } {
  const result = joinBodySchema.safeParse(raw);
  return result.success ? { ok: true, code: result.data.code } : { ok: false, message: GROUP_REFUSALS.invalidCode };
}

const invitationBodySchema = z.object({ email: z.string() });

/** The address as the app sent it: sendGroupInvitation trims and checks it. A body without one is refused as a bad one is. */
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
  const words = result.isResend ? INVITATION_WORDS.resent : INVITATION_WORDS.sent;
  return {
    sent: result.emailSent === true,
    resent: result.isResend === true,
    message: typeof result.warning === "string" && result.warning !== "" ? result.warning : words,
  };
}
