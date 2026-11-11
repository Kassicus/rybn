import { z } from "zod";
import { mobileRoute } from "@/lib/mobile/route-live";
import { removeWishlistItem, replaceWishlistItem } from "@/lib/mobile/wishlist-live";

export const dynamic = "force-dynamic";

/** Replace one of the caller's items. */
export const PUT = mobileRoute(({ userId, params, body }) => replaceWishlistItem(userId, params.id, body), { body: z.unknown() });

/** Delete one of the caller's items. */
export const DELETE = mobileRoute(({ userId, params }) => removeWishlistItem(userId, params.id));
