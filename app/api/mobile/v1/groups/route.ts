import { mobileRoute } from "@/lib/mobile/route-live";
import { groupListAnswer } from "@/lib/mobile/shopping-live";

export const dynamic = "force-dynamic";

/** The groups the caller belongs to, with a member count. */
export const GET = mobileRoute(() => groupListAnswer());
