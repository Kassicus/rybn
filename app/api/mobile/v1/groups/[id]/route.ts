import { deleteGroupAnswer } from "@/lib/mobile/groups-live";
import { mobileRoute } from "@/lib/mobile/route-live";
import { groupAnswer } from "@/lib/mobile/shopping-live";

export const dynamic = "force-dynamic";

/** One group: its members and upcoming dates. */
export const GET = mobileRoute(({ userId, params }) => groupAnswer(userId, params.id));

/** Delete the group, for everyone in it. Only its owner may. */
export const DELETE = mobileRoute(({ userId, params }) => deleteGroupAnswer(userId, params.id));
