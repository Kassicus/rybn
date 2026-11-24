import { z } from "zod";
import { addablePeopleAnswer, addPeopleAnswer } from "@/lib/mobile/group-gifts-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Who the person who made a group gift can add to it, by name. */
export const GET = mobileRoute(({ params }) => addablePeopleAnswer(params.id));

/** Add people to a group gift, all or none. Only the person who made it can. The handler checks the body itself. */
export const POST = mobileRoute(({ userId, params, body }) => addPeopleAnswer(userId, params.id, body), { body: z.unknown() });
