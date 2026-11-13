/**
 * Adding, changing and deleting a group's dates, with the website's own actions. Who may change or delete a date is the
 * database's to decide (its maker, or an owner or admin of the group, and still in it); these never judge it, and
 * never read the group page's mark: a date the caller may not change answers 404, as one that is not there does.
 */
import { createGroupDate, deleteGroupDate, updateGroupDate } from "@/lib/actions/occasions";
import { actionAnswer } from "./action-response";
import { pathUuid } from "./database";
import { groupDateRow, groupNameOf } from "./group-reads";
import { GROUP_DATE_ROUTE_ANSWERS, groupDateOccasion, parseGroupDateBody } from "./groups";
import type { MobileOccasion } from "./occasions";
import { mobileError } from "./route";

/** The date, when it is one of this group's dates the caller can see; null otherwise, so nothing is asked of it. */
async function dateInGroup(dateId: string, groupId: string): Promise<{ id: string } | null> {
  const row = await groupDateRow(dateId);
  return row !== null && row.groupId === groupId ? { id: row.id } : null;
}

export async function addGroupDateAnswer(rawGroupId: string, raw: unknown): Promise<Response | { occasion: MobileOccasion }> {
  const groupId = pathUuid(rawGroupId);
  if (groupId === null) return mobileError("not_found");
  const parsed = parseGroupDateBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  // Someone not in the group is told it is not there, as GET /groups/{id} tells them, and nothing is added.
  const groupName = await groupNameOf(groupId);
  if (groupName === null) return mobileError("not_found");
  // The group is the path's; only the name and the date come from the body.
  const result = await createGroupDate({ groupId, name: parsed.name, occasionDate: parsed.date });
  const failed = actionAnswer(result, "createGroupDate", GROUP_DATE_ROUTE_ANSWERS.add);
  if (failed) return failed;
  const { id } = (result as { data: { id: string } }).data;
  return { occasion: groupDateOccasion(id, parsed.name, parsed.date, { id: groupId, name: groupName }) };
}

export async function saveGroupDateAnswer(
  rawGroupId: string,
  rawDateId: string,
  raw: unknown,
): Promise<Response | { occasion: MobileOccasion }> {
  const groupId = pathUuid(rawGroupId);
  const dateId = pathUuid(rawDateId);
  if (groupId === null || dateId === null) return mobileError("not_found");
  const parsed = parseGroupDateBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const groupName = await groupNameOf(groupId);
  if (groupName === null) return mobileError("not_found");
  // A date of another group is not this one's to change through this path, and nothing is written.
  const date = await dateInGroup(dateId, groupId);
  if (date === null) return mobileError("not_found");
  const result = await updateGroupDate(date.id, { name: parsed.name, occasionDate: parsed.date });
  const failed = actionAnswer(result, "updateGroupDate", GROUP_DATE_ROUTE_ANSWERS.save);
  if (failed) return failed;
  return { occasion: groupDateOccasion(date.id, parsed.name, parsed.date, { id: groupId, name: groupName }) };
}

export async function deleteGroupDateAnswer(rawGroupId: string, rawDateId: string): Promise<Response | null> {
  const groupId = pathUuid(rawGroupId);
  const dateId = pathUuid(rawDateId);
  if (groupId === null || dateId === null) return mobileError("not_found");
  const date = await dateInGroup(dateId, groupId);
  if (date === null) return mobileError("not_found");
  const result = await deleteGroupDate(date.id);
  const failed = actionAnswer(result, "deleteGroupDate", GROUP_DATE_ROUTE_ANSWERS.delete);
  if (failed) return failed;
  return null;
}
