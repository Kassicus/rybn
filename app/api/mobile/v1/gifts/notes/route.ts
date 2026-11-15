import { z } from "zod";
import { saveNotesAnswer } from "@/lib/mobile/gift-notes-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** Save the notes on one heading of the caller's gift list, and a typed name's name with them. */
export const PUT = mobileRoute(({ userId, body }) => saveNotesAnswer(userId, body), { body: z.unknown() });
