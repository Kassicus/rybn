import { removeProfilePictureAnswer, setProfilePictureAnswer } from "@/lib/mobile/profile-picture-live";
import { mobileRoute } from "@/lib/mobile/route-live";

export const dynamic = "force-dynamic";

/**
 * Set the caller's picture from the raw bytes the phone sends. No `body` option: that would read the request as JSON,
 * so setProfilePictureAnswer reads the bytes itself. The path must not end in an image extension (proxy.ts skips those).
 */
export const POST = mobileRoute(({ userId, request }) => setProfilePictureAnswer(userId, request));

/** Remove the caller's picture. */
export const DELETE = mobileRoute(({ userId }) => removeProfilePictureAnswer(userId));
