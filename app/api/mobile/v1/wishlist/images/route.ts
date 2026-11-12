import { mobileRoute } from "@/lib/mobile/route-live";
import { pictureAnswer } from "@/lib/mobile/picture-live";

export const dynamic = "force-dynamic";

/**
 * Store a picture the phone sends as raw bytes. No `body` option: that would read the request as JSON,
 * so pictureAnswer reads the bytes itself. The path must not end in an image extension (proxy.ts skips those).
 */
export const POST = mobileRoute(({ userId, request }) => pictureAnswer(userId, request, "wishlist-images"));
