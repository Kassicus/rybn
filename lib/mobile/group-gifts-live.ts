import {
  addMembersToGroupGift,
  createGroupGift,
  deleteGroupGift,
  getAvailableGroupMembers,
  getGroupGiftById,
  getGroupGiftChoices,
  getMyGroupGifts,
  updateMyContribution,
} from "@/lib/actions/gifts";
import { actionAnswer, databaseFailure } from "./action-response";
import { pathUuid } from "./database";
import {
  GROUP_GIFT_ROUTE_ANSWERS,
  giftChoices,
  groupGiftPage,
  groupGiftSummary,
  parseAddPeopleBody,
  parseNewGroupGiftBody,
  parsePledgeBody,
  type MobileGroupGift,
  type MobileGroupGiftSummary,
} from "./group-gifts";
import { byPersonName, mobilePerson, type MobilePerson } from "./occasions";
import { mobileError } from "./route";

/** Every group gift the caller is in, newest joined first. The action leaves out any that names the caller. */
export async function groupGiftListAnswer(userId: string): Promise<Response | { groupGifts: MobileGroupGiftSummary[] }> {
  const result = await getMyGroupGifts();
  // The action's errors are the database's words, which never reach the app.
  const failed = databaseFailure(result, "getMyGroupGifts");
  if (failed) return failed;
  return { groupGifts: result.data.map((gift) => groupGiftSummary(gift, userId)) };
}

/** The caller's groups, and everyone they share one with: who a new group gift can be in and for. */
export async function groupGiftChoicesAnswer(): Promise<Response | ReturnType<typeof giftChoices>> {
  const result = await getGroupGiftChoices();
  const failed = databaseFailure(result, "getGroupGiftChoices");
  if (failed) return failed;
  return giftChoices((result as Extract<typeof result, { data: object }>).data);
}

/**
 * Start a gift from a body the door has checked, through the website's own action (which checks it again), and answer
 * the gift as its page reads it. Only the checked fields reach the action, and the caller is the action's, never the body's.
 */
export async function createGroupGiftAnswer(
  userId: string,
  raw: unknown,
): Promise<Response | { groupGift: MobileGroupGift }> {
  const parsed = parseNewGroupGiftBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const { groupId, recipientIds, name, description, targetAmount } = parsed.body;
  const result = await createGroupGift({
    name,
    description,
    group_id: groupId,
    recipient_ids: recipientIds,
    target_amount: targetAmount,
    is_active: true,
  });
  const failed = actionAnswer(result, "createGroupGift", GROUP_GIFT_ROUTE_ANSWERS.create);
  if (failed) return failed;

  // Answered from a read of the gift as its members see it, never from the row the action returns.
  const { id } = (result as Extract<typeof result, { data: object }>).data;
  return giftAfterWrite(userId, id, "createGroupGift");
}

/**
 * The gift as its members see it, read again after a write the caller was allowed to make. They are in the gift, so a
 * read that finds nothing is a fault (500), never a 404.
 */
async function giftAfterWrite(userId: string, id: string, write: string): Promise<Response | { groupGift: MobileGroupGift }> {
  const seen = await getGroupGiftById(id);
  const unread = databaseFailure(seen, `getGroupGiftById after ${write}`);
  if (unread) return unread;
  return { groupGift: groupGiftPage((seen as Extract<typeof seen, { data: object }>).data, userId) };
}

/** One gift as its page shows it. A gift that is not there, one the caller is not in and one that names them answer alike. */
export async function groupGiftAnswer(userId: string, rawId: string): Promise<Response | { groupGift: MobileGroupGift }> {
  const id = pathUuid(rawId);
  if (id === null) return mobileError("not_found");
  const seen = await getGroupGiftById(id);
  const failed = actionAnswer(seen, "getGroupGiftById", GROUP_GIFT_ROUTE_ANSWERS.one);
  if (failed) return failed;
  return { groupGift: groupGiftPage((seen as Extract<typeof seen, { data: object }>).data, userId) };
}

/** Delete a gift and its pledges and chat. Only its maker may; the action says so. Answers null (204) once it is gone. */
export async function deleteGroupGiftAnswer(rawId: string): Promise<Response | null> {
  const id = pathUuid(rawId);
  if (id === null) return mobileError("not_found");
  return actionAnswer(await deleteGroupGift(id), "deleteGroupGift", GROUP_GIFT_ROUTE_ANSWERS.delete);
}

/** Set the caller's own pledge and whether they have paid it, from a body the door has checked, and answer the gift. */
export async function pledgeAnswer(
  userId: string,
  rawId: string,
  raw: unknown,
): Promise<Response | { groupGift: MobileGroupGift }> {
  const id = pathUuid(rawId);
  if (id === null) return mobileError("not_found");
  const parsed = parsePledgeBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const result = await updateMyContribution(id, { contribution_amount: parsed.amount, has_paid: parsed.paid });
  const failed = actionAnswer(result, "updateMyContribution", GROUP_GIFT_ROUTE_ANSWERS.pledge);
  if (failed) return failed;
  return giftAfterWrite(userId, id, "updateMyContribution");
}

/** Who the maker can add to a gift: people in the caller's groups who are not in it and are not who it is for, by name. */
export async function addablePeopleAnswer(rawId: string): Promise<Response | { people: MobilePerson[] }> {
  const id = pathUuid(rawId);
  if (id === null) return mobileError("not_found");
  const result = await getAvailableGroupMembers(id);
  const failed = actionAnswer(result, "getAvailableGroupMembers", GROUP_GIFT_ROUTE_ANSWERS.people);
  if (failed) return failed;
  const { data } = result as Extract<typeof result, { data: object }>;
  return { people: data.map(mobilePerson).sort(byPersonName) };
}

/**
 * Add people to a gift from a body the door has checked, then answer the gift. The action adds all of them or none,
 * and answers one sentence whichever of them it refuses.
 */
export async function addPeopleAnswer(
  userId: string,
  rawId: string,
  raw: unknown,
): Promise<Response | { groupGift: MobileGroupGift }> {
  const id = pathUuid(rawId);
  if (id === null) return mobileError("not_found");
  const parsed = parseAddPeopleBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const failed = actionAnswer(await addMembersToGroupGift(id, parsed.ids), "addMembersToGroupGift", GROUP_GIFT_ROUTE_ANSWERS.add);
  if (failed) return failed;
  return giftAfterWrite(userId, id, "addMembersToGroupGift");
}
