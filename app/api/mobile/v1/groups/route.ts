import { z } from "zod";
import { createGroupAnswer } from "@/lib/mobile/groups-live";
import { mobileRoute } from "@/lib/mobile/route-live";
import { groupListAnswer } from "@/lib/mobile/shopping-live";

export const dynamic = "force-dynamic";

/** The groups the caller belongs to, with a member count. */
export const GET = mobileRoute(() => groupListAnswer());

/** Make a group with the caller as its owner, and answer its summary. The handler checks the body itself. */
export const POST = mobileRoute(({ body }) => createGroupAnswer(body), { body: z.unknown() });
