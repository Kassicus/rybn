import { createGroup, deleteGroup, leaveGroup } from "@/lib/actions/groups";
import { joinGroupByCode, sendGroupInvitation } from "@/lib/actions/invitations";
import { actionAnswer, databaseFailure } from "./action-response";
import { pathUuid } from "./database";
import { callerRole, groupSummary, inviteCodeOf } from "./group-reads";
import {
  GROUP_ROUTE_ANSWERS,
  invitationAnswer,
  parseInvitationBody,
  parseJoinBody,
  parseNewGroupBody,
  type InvitationAnswer,
} from "./groups";
import { mobileError } from "./route";
import type { GroupSummary } from "./shopping";

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
  const failed = actionAnswer(result, "joinGroupByCode", GROUP_ROUTE_ANSWERS.join);
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
  const failed = actionAnswer(result, "sendGroupInvitation", GROUP_ROUTE_ANSWERS.invitation);
  if (failed) return failed;
  // Answered field by field: whether the email went, whether it was sent again, and the website's sentence.
  return invitationAnswer(result as { emailSent: boolean; isResend: boolean; warning?: string });
}

export async function leaveGroupAnswer(rawGroupId: string): Promise<Response | null> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  const result = await leaveGroup(groupId);
  const failed = actionAnswer(result, "leaveGroup", GROUP_ROUTE_ANSWERS.leave);
  if (failed) return failed;
  return null;
}

export async function deleteGroupAnswer(userId: string, rawGroupId: string): Promise<Response | null> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  // Someone not in the group is told it is not there, as GET /groups/{id} tells them, and nothing is asked to delete it.
  if ((await callerRole(groupId, userId)) === null) return mobileError("not_found");
  const result = await deleteGroup(groupId);
  const failed = actionAnswer(result, "deleteGroup", GROUP_ROUTE_ANSWERS.delete);
  if (failed) return failed;
  return null;
}
