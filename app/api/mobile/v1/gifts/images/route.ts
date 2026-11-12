import { mobileRoute } from "@/lib/mobile/route-live";
import { pictureAnswer } from "@/lib/mobile/picture-live";

export const dynamic = "force-dynamic";

/** Store a gift's picture, as the wishlist's, in the gift-photos bucket. The path must not end in an image extension. */
export const POST = mobileRoute(({ userId, request }) => pictureAnswer(userId, request, "gift-photos"));
