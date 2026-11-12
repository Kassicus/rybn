import { z } from "zod";
import { addGiftAnswer, giftListAnswer } from "@/lib/mobile/gift-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** The caller's gifts for a season (this year when none is named), grouped by who they are for. */
export const GET = mobileRoute(({ userId, query }) => giftListAnswer(userId, query.season ?? null),
  { query: z.object({ season: z.string().optional() }) });

/** Add a gift that was not on anyone's list. */
export const POST = mobileRoute(({ userId, body }) => addGiftAnswer(userId, body), { body: z.unknown() });
