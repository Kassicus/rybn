import { mobileRoute } from "@/lib/mobile/route-live";
import { mobileRouteWithoutProfile } from "@/lib/mobile/route-no-profile";
import { loadMe } from "@/lib/mobile/me-live";
import { deleteAccountAnswer } from "@/lib/mobile/account-live";

export const dynamic = "force-dynamic";

/** Who's signed in. The app calls this at launch. */
export const GET = mobileRoute(({ userId }) => loadMe(userId));

/** Deletes the caller's account, knowing them from the bearer token without making a profile. 204; a failure is 500. */
export const DELETE = mobileRouteWithoutProfile(() => deleteAccountAnswer());
