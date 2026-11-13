import { z } from "zod";
import { deleteGroupDateAnswer, saveGroupDateAnswer } from "@/lib/mobile/group-dates-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Change one of the group's dates. Its maker, or an owner or admin of the group, may. */
export const PUT = mobileRoute(({ params, body }) => saveGroupDateAnswer(params.id, params.dateId, body), { body: z.unknown() });

/** Delete one of the group's dates, for everyone in it. Its maker, or an owner or admin of the group, may. */
export const DELETE = mobileRoute(({ params }) => deleteGroupDateAnswer(params.id, params.dateId));
