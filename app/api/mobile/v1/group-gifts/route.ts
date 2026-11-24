import { z } from "zod";
import { createGroupGiftAnswer, groupGiftListAnswer } from "@/lib/mobile/group-gifts-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** The group gifts the caller is in, the one they joined last first. */
export const GET = mobileRoute(({ userId }) => groupGiftListAnswer(userId));

/** Start a group gift in one of the caller's groups, for people they share a group with, and answer it. The handler checks the body itself. */
export const POST = mobileRoute(({ userId, body }) => createGroupGiftAnswer(userId, body), { body: z.unknown() });
