import { getUserId } from "@/lib/auth/require-auth";
import { createMobileRoute, parseMinBuild } from "./route";

/**
 * The same checks as mobileRoute (route-live.ts), for a route that must not
 * make a profile: the caller is known from the bearer token alone. DELETE /me
 * is built with it, since a try after one that stopped half way finds no
 * profile, and must not make one.
 *
 * It is its own module, not part of route-live.ts, because require-auth.ts
 * imports "server-only", and the route tests that import route-live.ts do not
 * mock it.
 */
export const mobileRouteWithoutProfile = createMobileRoute({
  identify: getUserId,
  minBuild: () => parseMinBuild(process.env.MOBILE_MIN_BUILD),
});
