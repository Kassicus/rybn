import { mobileRoute } from "@/lib/mobile/route-live";
import { wishlistChoices } from "@/lib/mobile/wishlist-live";

export const dynamic = "force-dynamic";

/** What the caller may tag one of their own items for now: their birthday and anniversary, and their groups' dates. */
export const GET = mobileRoute(({ userId }) => wishlistChoices(userId));
