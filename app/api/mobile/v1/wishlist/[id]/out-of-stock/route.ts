import { mobileRoute } from "@/lib/mobile/route-live";
import { clearOutOfStockAnswer, markOutOfStockAnswer } from "@/lib/mobile/stock-live";

export const dynamic = "force-dynamic";

/** Mark an item on someone else's list out of stock. Its owner never learns of it, and the answer says nobody's name. */
export const POST = mobileRoute(({ params }) => markOutOfStockAnswer(params.id));

/** Clear the mark: the item is back in stock. */
export const DELETE = mobileRoute(({ params }) => clearOutOfStockAnswer(params.id));
