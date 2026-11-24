import { deleteGroupGiftAnswer, groupGiftAnswer } from "@/lib/mobile/group-gifts-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** One group gift, as a member who is not named on it sees it. */
export const GET = mobileRoute(({ userId, params }) => groupGiftAnswer(userId, params.id));

/** Delete a group gift, its pledges and its chat. Only the person who made it can. */
export const DELETE = mobileRoute(({ params }) => deleteGroupGiftAnswer(params.id));
