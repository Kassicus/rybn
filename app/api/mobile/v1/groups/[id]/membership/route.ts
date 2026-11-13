import { leaveGroupAnswer } from "@/lib/mobile/groups-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Leave the group. Its owner cannot. */
export const DELETE = mobileRoute(({ params }) => leaveGroupAnswer(params.id));
