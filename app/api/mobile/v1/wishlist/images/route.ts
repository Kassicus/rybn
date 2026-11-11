import { mobileRoute } from "@/lib/mobile/route-live";
import { mobileError } from "@/lib/mobile/route";
import { checkPicture } from "@/lib/mobile/picture";
import { storePicture } from "@/lib/mobile/picture-live";

export const dynamic = "force-dynamic";

/**
 * Store a picture the phone sends as raw bytes. No `body` option: that would read the request as JSON,
 * so the handler reads the bytes itself. The path must not end in an image extension (proxy.ts skips those).
 */
export const POST = mobileRoute(async ({ userId, request }) => {
  const bytes = new Uint8Array(await request.arrayBuffer());
  const checked = checkPicture(request.headers.get("content-type"), bytes);
  if (!checked.ok) return mobileError("invalid", checked.message);
  return storePicture(userId, bytes, checked);
});
