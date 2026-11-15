import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

type StockMocks = { markOutOfStock: Mock; unmarkOutOfStock: Mock };

const holder = vi.hoisted(() => ({ current: undefined as unknown as StockMocks }));

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/actions/wishlist", () => ({
  markOutOfStock: (...a: unknown[]) => holder.current.markOutOfStock(...a),
  unmarkOutOfStock: (...a: unknown[]) => holder.current.unmarkOutOfStock(...a),
}));

const { POST, DELETE } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");
const { IDS } = await import("@/lib/mobile/test-shopping");

const url = (id: string) => `http://localhost/api/mobile/v1/wishlist/${id}/out-of-stock`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (id: string = IDS.dutchOven) => bearer(url(id), { method: "POST" });
const del = (id: string = IDS.dutchOven) => bearer(url(id), { method: "DELETE" });

/** Each method beside the action it runs. */
const methods = () => [
  { name: "POST", send: POST, request: post, action: holder.current.markOutOfStock },
  { name: "DELETE", send: DELETE, request: del, action: holder.current.unmarkOutOfStock },
];

const NO_ROWS = "JSON object requested, multiple (or no) rows returned";

/** What the actions answer: Mom's Dutch oven, with who marked it, as the database has it. */
const ovenRow = (markedBy: string | null) => ({
  id: IDS.dutchOven,
  user_id: "user_2momABC",
  title: "Le Creuset Dutch oven",
  out_of_stock_marked_by: markedBy,
  out_of_stock_marked_at: markedBy === null ? null : "2026-11-13T10:00:00.000000+00:00",
});

beforeEach(() => {
  holder.current = {
    markOutOfStock: vi.fn(async () => ({ data: ovenRow("user_2abcDEF") })),
    unmarkOutOfStock: vi.fn(async () => ({ data: ovenRow(null) })),
  };
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST and DELETE /api/mobile/v1/wishlist/[id]/out-of-stock", () => {
  it("marks the item and answers 204 with no body", async () => {
    const res = await POST(post(), ctx(IDS.dutchOven));
    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(await res.text()).toBe("");
    expect(holder.current.markOutOfStock.mock.calls).toEqual([[IDS.dutchOven]]);
    expect(holder.current.unmarkOutOfStock).not.toHaveBeenCalled();
  });

  it("clears the mark and answers 204 with no body", async () => {
    const res = await DELETE(del(), ctx(IDS.dutchOven));
    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(await res.text()).toBe("");
    expect(holder.current.unmarkOutOfStock.mock.calls).toEqual([[IDS.dutchOven]]);
    expect(holder.current.markOutOfStock).not.toHaveBeenCalled();
  });

  it("never answers who marked it", async () => {
    for (const { send, request, action } of methods()) {
      action.mockResolvedValue({ data: ovenRow("user_2dadABC") });
      const res = await send(request(), ctx(IDS.dutchOven));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe("");
    }
  });

  it("answers 404 That isn't there any more. for an item that was not the caller's to mark", async () => {
    for (const { send, request, action } of methods()) {
      action.mockResolvedValue({ error: NO_ROWS, notFound: true });
      const res = await send(request(), ctx(IDS.dutchOven));
      const text = await res.text();
      expect(res.status).toBe(404);
      expect(JSON.parse(text)).toEqual({ error: { code: "not_found", message: "That isn't there any more." } });
      expect(text).not.toMatch(/JSON object|rows/);
    }
  });

  it("answers 404 for an id that is not a UUID, asking nothing", async () => {
    for (const { send, request } of methods()) {
      const res = await send(request("x"), ctx("x"));
      expect([res.status, (await res.json()).error]).toEqual([404, { code: "not_found", message: "That isn't there any more." }]);
    }
    expect(holder.current.markOutOfStock).not.toHaveBeenCalled();
    expect(holder.current.unmarkOutOfStock).not.toHaveBeenCalled();
  });

  it("reads an upper-case id as the same item", async () => {
    const upper = IDS.dutchOven.toUpperCase();
    for (const { send, request, action } of methods()) {
      expect((await send(request(upper), ctx(upper))).status).toBe(204);
      expect(action.mock.calls).toEqual([[IDS.dutchOven]]);
    }
  });

  it("answers 401 when the action finds nobody signed in, and 500 without the database's words for anything else", async () => {
    for (const { name, send, request, action } of methods()) {
      action.mockResolvedValueOnce({ error: "Not authenticated" });
      expect((await send(request(), ctx(IDS.dutchOven))).status).toBe(401);

      action.mockResolvedValueOnce({ error: "connection reset", notFound: false });
      vi.mocked(console.error).mockClear();
      const res = await send(request(), ctx(IDS.dutchOven));
      const text = await res.text();
      expect([name, res.status, JSON.parse(text).error.code]).toEqual([name, 500, "server_error"]);
      expect(text).not.toMatch(/connection/);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining("/out-of-stock"), expect.anything());
    }
  });

  it("answers 401 without a bearer, marking nothing", async () => {
    for (const { name, send } of methods()) {
      const res = await send(new Request(url(IDS.dutchOven), { method: name }), ctx(IDS.dutchOven));
      expect([name, res.status]).toEqual([name, 401]);
    }
    expect(holder.current.markOutOfStock).not.toHaveBeenCalled();
    expect(holder.current.unmarkOutOfStock).not.toHaveBeenCalled();
  });
});
