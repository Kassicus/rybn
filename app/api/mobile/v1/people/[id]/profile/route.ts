import { personProfileAnswer } from "@/lib/mobile/profile-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Another person's profile as the caller may see it, with the groups the two share. The caller's own id answers 404. */
export const GET = mobileRoute(({ userId, params }) => personProfileAnswer(userId, params.id));
