import { ensureProfile } from "@/lib/auth/ensure-profile";
import { createMobileRoute, parseMinBuild } from "./route";

/** Build every /api/mobile/v1 route with this. See route.ts for what it checks. */
export const mobileRoute = createMobileRoute({
  identify: ensureProfile,
  minBuild: () => parseMinBuild(process.env.MOBILE_MIN_BUILD),
});
