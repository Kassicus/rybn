import { z } from "zod";
import { pledgeAnswer } from "@/lib/mobile/group-gifts-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Set the caller's pledge to a group gift and whether they have paid it. The handler checks the body itself. */
export const PUT = mobileRoute(({ userId, params, body }) => pledgeAnswer(userId, params.id, body), { body: z.unknown() });
