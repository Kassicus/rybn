import { groupGiftChoicesAnswer } from "@/lib/mobile/group-gifts-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** The caller's groups, and everyone who shares one with them: who a new group gift can be in and for. */
export const GET = mobileRoute(() => groupGiftChoicesAnswer());
