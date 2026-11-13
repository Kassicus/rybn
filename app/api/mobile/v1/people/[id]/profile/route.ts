import { personProfileAnswer } from "@/lib/mobile/profile-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Another person's profile as the caller may see it, with the groups the two share. */
export const GET = mobileRoute(({ params }) => personProfileAnswer(params.id));
