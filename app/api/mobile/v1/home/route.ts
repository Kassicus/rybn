import { mobileRoute } from "@/lib/mobile/route-live";
import { homeAnswer } from "@/lib/mobile/shopping-live";

export const dynamic = "force-dynamic";

/** What is coming up, and whom the caller has started shopping for. */
export const GET = mobileRoute(({ userId }) => homeAnswer(userId));
