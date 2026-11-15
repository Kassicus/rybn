import { describe, it, expect, vi } from "vitest";
import { WISHLIST_ITEM_COLUMNS, readVisibleMarks, unmarked, withMarks, type ItemMark } from "./marks";

/**
 * The marks on a wishlist item (bought, out of stock) are read through the
 * database function visible_item_marks(), which answers only for items the
 * caller can see and does not own, and only for items that carry a mark. A
 * wishlist item read with a signed-in person's client names
 * WISHLIST_ITEM_COLUMNS, which hold no mark.
 */

const MARK_COLUMNS = ["purchased", "purchased_at", "out_of_stock_marked_by", "out_of_stock_marked_at"];

type Answer = { data: unknown; error: unknown };

/** Just enough of a Supabase client for database function calls, answering each call with `answer(args)`. */
function clientAnswering(answer: (args: { p_item_ids: string[] }) => Answer) {
  const rpc = vi.fn(async (_name: string, args: { p_item_ids: string[] }) => answer(args));
  const from = vi.fn();
  const client = { rpc, from } as unknown as Parameters<typeof readVisibleMarks>[0];
  return { client, rpc, from };
}

const row = (item_id: string, purchased: boolean, out_of_stock_marked_by: string | null = null) => ({
  item_id,
  purchased,
  out_of_stock_marked_by,
});

describe("WISHLIST_ITEM_COLUMNS", () => {
  it("names the item's columns, never a mark or *", () => {
    expect(WISHLIST_ITEM_COLUMNS).toBe(
      "id, user_id, title, description, url, price, image_url, priority, category, privacy_settings, created_at, updated_at"
    );
    const named = WISHLIST_ITEM_COLUMNS.split(",").map((column) => column.trim());
    for (const column of [...MARK_COLUMNS, "*", ""]) {
      expect(named).not.toContain(column);
    }
  });
});

describe("readVisibleMarks", () => {
  it("calls visible_item_marks() once with the ids and answers its rows by item id", async () => {
    const { client, rpc, from } = clientAnswering(() => ({
      data: [row("i1", true), row("i2", false, "user_giver")],
      error: null,
    }));

    const result = await readVisibleMarks(client, ["i1", "i2", "i3"]);

    expect(result).toEqual({
      marks: new Map<string, ItemMark>([
        ["i1", { purchased: true, outOfStockMarkedBy: null }],
        ["i2", { purchased: false, outOfStockMarkedBy: "user_giver" }],
      ]),
    });
    expect(rpc.mock.calls).toEqual([["visible_item_marks", { p_item_ids: ["i1", "i2", "i3"] }]]);
    expect(from).not.toHaveBeenCalled();
  });

  it("asks for each id once", async () => {
    const { client, rpc } = clientAnswering(() => ({ data: [], error: null }));

    await readVisibleMarks(client, ["i1", "i2", "i1", "i2", "i3"]);

    expect(rpc.mock.calls).toEqual([["visible_item_marks", { p_item_ids: ["i1", "i2", "i3"] }]]);
  });

  it("asks nothing when there are no ids", async () => {
    const { client, rpc } = clientAnswering(() => ({ data: [], error: null }));

    expect(await readVisibleMarks(client, [])).toEqual({ marks: new Map() });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("asks for at most 500 ids a call and joins the answers", async () => {
    const ids = Array.from({ length: 1201 }, (_, i) => `i${i}`);
    const { client, rpc } = clientAnswering(({ p_item_ids }) => ({
      data: p_item_ids.map((id) => row(id, true)),
      error: null,
    }));

    const result = await readVisibleMarks(client, [...ids, ...ids]);

    const asked = rpc.mock.calls.map(([, args]) => args.p_item_ids);
    expect(asked.map((chunk) => chunk.length)).toEqual([500, 500, 201]);
    expect(asked.flat()).toEqual(ids);
    expect("marks" in result && [...result.marks.keys()]).toEqual(ids);
  });

  it("answers the database's error by its message and code, whichever call it came from", async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `i${i}`);
    const { client } = clientAnswering(({ p_item_ids }) =>
      p_item_ids.includes("i500")
        ? { data: null, error: { code: "57014", message: "canceling statement due to statement timeout", details: null, hint: null } }
        : { data: [row("i0", true)], error: null }
    );

    expect(await readVisibleMarks(client, ids)).toEqual({
      error: { message: "canceling statement due to statement timeout", code: "57014" },
    });
  });

  it("answers an empty map when no item carries a mark", async () => {
    const { client } = clientAnswering(() => ({ data: null, error: null }));

    expect(await readVisibleMarks(client, ["i1"])).toEqual({ marks: new Map() });
  });
});

describe("withMarks", () => {
  const marks = new Map<string, ItemMark>([
    ["i1", { purchased: true, outOfStockMarkedBy: null }],
    ["i2", { purchased: false, outOfStockMarkedBy: "user_giver" }],
  ]);

  it("sets the bought and out-of-stock marks from the map, and leaves the two times null", () => {
    expect(withMarks({ id: "i1", title: "Scarf" }, marks)).toEqual({
      id: "i1",
      title: "Scarf",
      purchased: true,
      purchased_at: null,
      out_of_stock_marked_by: null,
      out_of_stock_marked_at: null,
    });
    expect(withMarks({ id: "i2", title: "Oven" }, marks)).toEqual({
      id: "i2",
      title: "Oven",
      purchased: false,
      purchased_at: null,
      out_of_stock_marked_by: "user_giver",
      out_of_stock_marked_at: null,
    });
  });

  it("answers a row the map has nothing for as unmarked", () => {
    expect(withMarks({ id: "i3", title: "Book" }, marks)).toEqual(unmarked({ id: "i3", title: "Book" }));
  });
});

describe("unmarked", () => {
  it("sets all four mark fields unmarked, keeping the row's own columns", () => {
    expect(unmarked({ id: "i1", title: "Scarf" })).toEqual({
      id: "i1",
      title: "Scarf",
      purchased: false,
      purchased_at: null,
      out_of_stock_marked_by: null,
      out_of_stock_marked_at: null,
    });
  });
});
