import { z } from "zod";
import { joinGroupAnswer } from "@/lib/mobile/groups-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Join the group whose invite code the body holds, and answer its summary. */
export const POST = mobileRoute(({ body }) => joinGroupAnswer(body), { body: z.unknown() });
