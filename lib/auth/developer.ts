import { getUserId } from "./require-auth";

/**
 * The allow-list for developer-only surfaces: /admin/api-explorer and
 * /api/test-reminders.
 *
 * DEVELOPER_USER_IDS holds Clerk user ids ("user_..."), separated by commas
 * or whitespace. This app has no site-admin role, and these surfaces do not
 * need one: a short list of ids in the environment says exactly who may see
 * them, per deployment, and is read on the server at request time.
 *
 * It fails closed. Unset or blank means nobody, so a deployment that has not
 * been told who its developers are serves these surfaces to no one. There is
 * no NODE_ENV branch -- the list is the only thing that decides, on every
 * host.
 *
 * The check belongs in each page and route that uses it (see the Next
 * authentication guide: a layout does not re-run on navigation and does not
 * stop the segment beneath it from rendering), so call getDeveloperId() there
 * rather than relying on where a file sits in the tree.
 */
function developerIds(): Set<string> {
  return new Set(
    (process.env.DEVELOPER_USER_IDS ?? "").split(/[\s,]+/).filter(Boolean)
  );
}

/** Whether this Clerk user id is on DEVELOPER_USER_IDS. Exact match only. */
export function isDeveloper(userId: string | null | undefined): boolean {
  return !!userId && developerIds().has(userId);
}

/**
 * The signed-in person's Clerk user id if they are on DEVELOPER_USER_IDS,
 * otherwise null -- signed out and signed-in-but-not-listed look the same to
 * the caller, which should answer both as "not found".
 */
export async function getDeveloperId(): Promise<string | null> {
  const userId = await getUserId();
  return isDeveloper(userId) ? userId : null;
}
