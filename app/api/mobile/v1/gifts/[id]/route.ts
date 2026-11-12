import { z } from "zod";
import { deleteGiftAnswer, giftAnswer, saveGiftAnswer } from "@/lib/mobile/gift-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/** One of the caller's gifts, with the occasions it could be filed under. */
export const GET = mobileRoute(({ userId, params }) => giftAnswer(userId, params.id));

/** Save changes to one of the caller's gifts. */
export const PUT = mobileRoute(({ userId, params, body }) => saveGiftAnswer(userId, params.id, body), { body: z.unknown() });

/** Delete one of the caller's gifts: not one whose claim is still held, unless it is past Claimed and its item can no longer be seen. */
export const DELETE = mobileRoute(({ userId, params }) => deleteGiftAnswer(userId, params.id));
