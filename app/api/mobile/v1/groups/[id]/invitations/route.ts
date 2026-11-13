import { z } from "zod";
import { sendInvitationAnswer } from "@/lib/mobile/groups-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Invite an address to the group by email, and say whether the email went. */
export const POST = mobileRoute(({ params, body }) => sendInvitationAnswer(params.id, body), { body: z.unknown() });
