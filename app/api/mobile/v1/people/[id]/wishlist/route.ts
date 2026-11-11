import { z } from "zod";
import { mobileRoute } from "@/lib/mobile/route-live";
import { personListAnswer } from "@/lib/mobile/shopping-live";

export const dynamic = "force-dynamic";

/** Another person's wishlist as the caller may see it, with the caller's own gifts for them. */
export const GET = mobileRoute(({ userId, params, query }) => personListAnswer(userId, params.id, query.occasion ?? null),
  { query: z.object({ occasion: z.string().optional() }) });
