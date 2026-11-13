import { inviteCodeAnswer } from "@/lib/mobile/groups-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** The group's invite code, to one of its members. */
export const GET = mobileRoute(({ params }) => inviteCodeAnswer(params.id));
