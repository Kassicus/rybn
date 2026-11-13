import { z } from "zod";
import { saveVisibilityAnswer } from "@/lib/mobile/profile-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Choose which kinds of group see the caller's profile fields, for every field they have. The handler checks the body. */
export const PUT = mobileRoute(({ body }) => saveVisibilityAnswer(body), { body: z.unknown() });
