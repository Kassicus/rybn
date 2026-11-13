import { z } from "zod";
import { addGroupDateAnswer } from "@/lib/mobile/group-dates-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Add a date to the group, such as Christmas, for everyone in it. Any member may. */
export const POST = mobileRoute(({ params, body }) => addGroupDateAnswer(params.id, body), { body: z.unknown() });
