import { z } from "zod";
import { mobileRoute } from "@/lib/mobile/route-live";
import { addWishlistItem, listWishlist } from "@/lib/mobile/wishlist-live";

export const dynamic = "force-dynamic";

/** The caller's own wishlist. */
export const GET = mobileRoute(() => listWishlist());

/** Add an item. The handler checks the body itself so it can answer a plain sentence. */
export const POST = mobileRoute(({ userId, body }) => addWishlistItem(userId, body), { body: z.unknown() });
