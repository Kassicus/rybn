import { createGroup, deleteGroup, leaveGroup } from "@/lib/actions/groups";
import { joinGroupByCode, sendGroupInvitation } from "@/lib/actions/invitations";
import { GROUP_RULES } from "@/lib/schemas/groups";
import { NOT_A_MEMBER, databaseFailure } from "./action-response";
import { pathUuid } from "./database";
import { callerRole, groupSummary, inviteCodeOf } from "./group-reads";
import {
  GROUP_REFUSALS,
  invitationAnswer,
  parseInvitationBody,
  parseJoinBody,
  parseNewGroupBody,
  type InvitationAnswer,
} from "./groups";
import { mobileError } from "./route";
import type { GroupSummary } from "./shopping";

/**
 * The answer for a group or invitation action that failed, or null when it succeeded. Signed out: 401. One of
 * `notFound`: 404, as for a group the caller cannot see. One of `refusals`: 422 with the website's sentence. Anything
 * else throws, naming the action, so mobileRoute logs it and answers the plain 500.
 */
function actionAnswer(
  result: object,
  action: string,
  { refusals = [], notFound = [] }: { refusals?: readonly string[]; notFound?: readonly string[] } = {},
): Response | null {
  const error: unknown = "error" in result ? result.error : undefined;
  if (typeof error === "string") {
    if (notFound.includes(error)) return mobileError("not_found");
    if (refusals.includes(error)) return mobileError("invalid", error);
  }
  return databaseFailure(result, action);
}

/** The summary of a group the caller has just made or joined; they are in it, so not reading it is a fault. */
async function summaryAfter(groupId: string, action: string): Promise<GroupSummary> {
  const summary = await groupSummary(groupId);
  if (summary === null) throw new Error(`${action}: group ${groupId} could not be read afterwards`);
  return summary;
}

export async function createGroupAnswer(raw: unknown): Promise<Response | { group: GroupSummary }> {
  const parsed = parseNewGroupBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const { name, description, type } = parsed.body;
  // Only the checked name, description and kind reach the action. A description sent as null is none.
  const result = await createGroup(description === null ? { name, type } : { name, description, type });
  // Every refusal the person could cause was answered at the door, so any other error is a fault.
  const failed = databaseFailure(result, "createGroup");
  if (failed) return failed;
  // Answered from a read of named columns, never from the row the action returns (it holds the invite code).
  return { group: await summaryAfter((result as { data: { id: string } }).data.id, "createGroup") };
}

export async function joinGroupAnswer(raw: unknown): Promise<Response | { group: GroupSummary }> {
  const parsed = parseJoinBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const result = await joinGroupByCode(parsed.code);
  const failed = actionAnswer(result, "joinGroupByCode", {
    refusals: [GROUP_REFUSALS.invalidCode, GROUP_REFUSALS.alreadyMember, GROUP_REFUSALS.stillSettingUp],
  });
  if (failed) return failed;
  return { group: await summaryAfter((result as { data: { id: string } }).data.id, "joinGroupByCode") };
}

/** The group's invite code, to one of its members. Anyone else is told the group is not there. */
export async function inviteCodeAnswer(rawGroupId: string): Promise<Response | { code: string }> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  const code = await inviteCodeOf(groupId);
  if (code === null) return mobileError("not_found");
  return { code };
}

export async function sendInvitationAnswer(rawGroupId: string, raw: unknown): Promise<Response | InvitationAnswer> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  const parsed = parseInvitationBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  // The group is the path's and the address the body's. Nothing else from the body reaches the action, which reads
  // the group's name itself.
  const result = await sendGroupInvitation({ groupId, email: parsed.email });
  const failed = actionAnswer(result, "sendGroupInvitation", {
    notFound: [NOT_A_MEMBER],
    refusals: [GROUP_RULES.email, GROUP_REFUSALS.hourlyLimit, GROUP_REFUSALS.alreadyInGroup],
  });
  if (failed) return failed;
  // Answered field by field: whether the email went, whether it was sent again, and the website's sentence.
  return invitationAnswer(result as { emailSent: boolean; isResend: boolean; warning?: string });
}

export async function leaveGroupAnswer(rawGroupId: string): Promise<Response | null> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  const result = await leaveGroup(groupId);
  const failed = actionAnswer(result, "leaveGroup", {
    notFound: [NOT_A_MEMBER],
    refusals: [GROUP_REFUSALS.ownerCannotLeave],
  });
  if (failed) return failed;
  return null;
}

export async function deleteGroupAnswer(userId: string, rawGroupId: string): Promise<Response | null> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  // Someone not in the group is told it is not there, as GET /groups/{id} tells them, and nothing is asked to delete it.
  if ((await callerRole(groupId, userId)) === null) return mobileError("not_found");
  const result = await deleteGroup(groupId);
  const failed = actionAnswer(result, "deleteGroup", { refusals: [GROUP_REFUSALS.onlyOwnerDeletes] });
  if (failed) return failed;
  return null;
}
