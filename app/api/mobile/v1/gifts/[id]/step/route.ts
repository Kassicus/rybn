import { z } from "zod";
import { stepGiftAnswer } from "@/lib/mobile/gift-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Move one of the caller's gifts one step forward or back. */
export const POST = mobileRoute(({ userId, params, body }) => stepGiftAnswer(userId, params.id, body), { body: z.unknown() });
