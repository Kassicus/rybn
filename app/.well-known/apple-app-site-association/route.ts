import { APPLE_APP_SITE_ASSOCIATION } from "@/lib/mobile/app-links";

// The file is the same for every request, so it is made once, when the site is built.
export const dynamic = "force-static";

/**
 * The association file iOS reads to open the site's invitation links in the app, as JSON. Anyone may read it, signed
 * in or not: it names only the app and the one path.
 */
export async function GET(): Promise<Response> {
  return Response.json(APPLE_APP_SITE_ASSOCIATION);
}
