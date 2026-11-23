import { createGroupGift, getGroupGiftById, getGroupGiftChoices, getMyGroupGifts } from "@/lib/actions/gifts";
import { actionAnswer, databaseFailure } from "./action-response";
import {
  GROUP_GIFT_ROUTE_ANSWERS,
  giftChoices,
  groupGiftPage,
  groupGiftSummary,
  parseNewGroupGiftBody,
  type MobileGroupGift,
  type MobileGroupGiftSummary,
} from "./group-gifts";
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

  // Answered from a read of the gift as its members see it, never from the row the action returns. The caller is in
  // the gift they have just made, so not reading it is a fault.
  const { id } = (result as Extract<typeof result, { data: object }>).data;
  const seen = await getGroupGiftById(id);
  const unread = databaseFailure(seen, "getGroupGiftById after createGroupGift");
  if (unread) return unread;
  return { groupGift: groupGiftPage((seen as Extract<typeof seen, { data: object }>).data, userId) };
}
