import { mobileRoute } from "@/lib/mobile/route-live";
import { loadMe } from "@/lib/mobile/me-live";

export const dynamic = "force-dynamic";

/** Who's signed in. The app calls this at launch. */
export const GET = mobileRoute(({ userId }) => loadMe(userId));
