import type { createClient } from "@/lib/supabase/server";

/** The columns of a wishlist item a signed-in person's client reads. */
export const WISHLIST_ITEM_COLUMNS =
  "id, user_id, title, description, details, url, price, image_url, priority, category, privacy_settings, created_at, updated_at";

export type ItemMark = { purchased: boolean; outOfStockMarkedBy: string | null };

/** The four mark fields the site's item shape carries. */
export type MarkFields = {
  purchased: boolean;
  purchased_at: null;
  out_of_stock_marked_by: string | null;
  out_of_stock_marked_at: null;
};

/**
 * visible_item_marks() answers at most one row an item, and the hosted API at
 * most 1000 rows a request, so a long list is asked in calls of this many ids.
 */
const IDS_PER_CALL = 500;

/**
 * The marks of the given items that the signed-in person can see and does not
 * own, by item id, from visible_item_marks(). An item that is not in the map
 * carries no mark for them.
 *
 * visible_item_marks() answers only about the caller of the client it is
 * called with: an item they own, one they cannot see and one with no mark get
 * no row.
 */
export async function readVisibleMarks(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemIds: string[],
): Promise<{ marks: Map<string, ItemMark> } | { error: { message: string; code?: string } }> {
  const ids = [...new Set(itemIds)];
  const calls: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_PER_CALL) calls.push(ids.slice(i, i + IDS_PER_CALL));

  const answers = await Promise.all(
    calls.map((p_item_ids) => supabase.rpc("visible_item_marks", { p_item_ids })),
  );

  const marks = new Map<string, ItemMark>();
  for (const { data, error } of answers) {
    if (error) {
      return { error: { message: error.message, code: error.code } };
    }
    for (const row of data ?? []) {
      marks.set(row.item_id, {
        purchased: row.purchased === true,
        outOfStockMarkedBy: row.out_of_stock_marked_by ?? null,
      });
    }
  }
  return { marks };
}

/** The row with its mark fields: from the map, or unmarked when the map has none for it. */
export function withMarks<T extends { id: string }>(row: T, marks: Map<string, ItemMark>): T & MarkFields {
  const mark = marks.get(row.id);
  return {
    ...row,
    purchased: mark?.purchased ?? false,
    purchased_at: null,
    out_of_stock_marked_by: mark?.outOfStockMarkedBy ?? null,
    out_of_stock_marked_at: null,
  };
}

/** The row with all four mark fields unmarked. */
export function unmarked<T>(row: T): T & MarkFields {
  return {
    ...row,
    purchased: false,
    purchased_at: null,
    out_of_stock_marked_by: null,
    out_of_stock_marked_at: null,
  };
}
