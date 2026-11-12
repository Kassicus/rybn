import { mobileRoute } from "@/lib/mobile/route-live";
import { groupAnswer } from "@/lib/mobile/shopping-live";

export const dynamic = "force-dynamic";

/** One group: its members and upcoming dates. */
export const GET = mobileRoute(({ userId, params }) => groupAnswer(userId, params.id));
