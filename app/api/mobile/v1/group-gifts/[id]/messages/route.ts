import { z } from "zod";
import { messagesAnswer, sendMessageAnswer } from "@/lib/mobile/group-gifts-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** A page of a group gift's chat, oldest first: the newest, or the ones before or after the message `before` or `after` names. */
export const GET = mobileRoute(({ userId, params, query }) => messagesAnswer(userId, params.id, query), {
  query: z.object({ before: z.string().optional(), after: z.string().optional() }),
});

/** Send a message to a group gift's chat. The handler checks the body itself. */
export const POST = mobileRoute(({ userId, params, body }) => sendMessageAnswer(userId, params.id, body), { body: z.unknown() });
