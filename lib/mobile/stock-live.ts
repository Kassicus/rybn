import { markOutOfStock, unmarkOutOfStock } from "@/lib/actions/wishlist";
import { databaseFailure } from "./action-response";
import { pathUuid } from "./database";
import { mobileError } from "./route";

/**
 * Runs one of the website's out-of-stock actions on an item on someone else's list. Done: null, which the route
 * answers 204; the item the action answers is never read or sent, so nothing says who marked it. An item that was not
 * the caller's to mark (their own, one they cannot see, or one that is gone) answers 404, and so does an id that is
 * not a UUID, without asking. Signed out: 401. Any other failure throws, so the route logs it and answers the standard
 * 500 without the database's words.
 */
async function stockAnswer(
  rawItemId: string,
  action: (itemId: string) => Promise<object>,
  name: string,
): Promise<Response | null> {
  const itemId = pathUuid(rawItemId);
  if (itemId === null) return mobileError("not_found");
  const result = await action(itemId);
  if ("notFound" in result && result.notFound === true) return mobileError("not_found");
  return databaseFailure(result, name);
}

/** Marks the item out of stock. */
export async function markOutOfStockAnswer(rawItemId: string): Promise<Response | null> {
  return stockAnswer(rawItemId, markOutOfStock, "markOutOfStock");
}

/** Clears the item's out-of-stock mark. */
export async function clearOutOfStockAnswer(rawItemId: string): Promise<Response | null> {
  return stockAnswer(rawItemId, unmarkOutOfStock, "unmarkOutOfStock");
}
