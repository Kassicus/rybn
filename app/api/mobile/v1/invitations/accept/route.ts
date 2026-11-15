import { z } from "zod";
import { acceptInvitationAnswer } from "@/lib/mobile/groups-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Accept the emailed invitation whose token the body holds, and answer the group's summary. */
export const POST = mobileRoute(({ body }) => acceptInvitationAnswer(body), { body: z.unknown() });
