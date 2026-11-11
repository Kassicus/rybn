import { ensureProfile } from "@/lib/auth/ensure-profile";
import { createMobileRoute, parseMinBuild } from "./route";

const rawMinBuild = process.env.MOBILE_MIN_BUILD;
if (rawMinBuild?.trim() && parseMinBuild(rawMinBuild) === null) {
  // Once per process. A typo here would otherwise switch the kill switch off without a word.
  console.warn(`[mobile] MOBILE_MIN_BUILD is ignored: ${JSON.stringify(rawMinBuild)} is not a whole number.`);
}

/** Build every /api/mobile/v1 route with this. See route.ts for what it checks. */
export const mobileRoute = createMobileRoute({
  identify: ensureProfile,
  minBuild: () => parseMinBuild(process.env.MOBILE_MIN_BUILD),
});
