import { z } from "zod";
import { myProfileAnswer, saveProfileAnswer } from "@/lib/mobile/profile-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** The caller's own profile: every field the website knows, what they saved in each, and who sees them. */
export const GET = mobileRoute(() => myProfileAnswer());

/** Save the caller's username, display name, bio and the fields they changed. The handler checks the body itself. */
export const PUT = mobileRoute(({ body }) => saveProfileAnswer(body), { body: z.unknown() });
