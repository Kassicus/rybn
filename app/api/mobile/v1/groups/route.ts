import { mobileRoute } from "@/lib/mobile/route-live";
import { listGroups } from "@/lib/mobile/wishlist-live";

export const dynamic = "force-dynamic";

/** The groups the caller belongs to, for the privacy picker. */
export const GET = mobileRoute(() => listGroups());
