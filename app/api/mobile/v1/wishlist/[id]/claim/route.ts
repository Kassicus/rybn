import { z } from "zod";
import { claimAnswer, releaseAnswer } from "@/lib/mobile/claim-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Claim an item on someone's list, for an occasion or none, and answer the gift that now tracks it. */
export const POST = mobileRoute(({ userId, params, body }) => claimAnswer(userId, params.id, body), { body: z.unknown() });

/** Give the claim up, and remove its gift. */
export const DELETE = mobileRoute(({ userId, params }) => releaseAnswer(userId, params.id));
