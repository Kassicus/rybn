import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * searchSite matches the person's text in two columns of each table it
 * searches by an `or` filter that eitherContains() writes, so the text is a
 * quoted value and nothing else. The two searches over one column (groups,
 * recipients) pass the text to .ilike() as a value.
 *
 * Follows the mocking pattern of lib/actions/claims.test.ts: getUserId and the
 * server client are mocked, and every query answers no rows. `orSpy` records
 * each `or` filter with the table it was asked of.
 */

const getUserId = vi.fn();

vi.mock("@/lib/auth/require-auth", () => ({
  getUserId: () => getUserId(),
}));

const orSpy = vi.fn();
const ilikeSpy = vi.fn();

function createSupabaseMock() {
  return {
    rpc: vi.fn(async () => ({ data: [], error: null })),
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "gte", "lte"]) {
        chain[method] = () => chain;
      }
      chain.or = (filter: unknown) => {
        orSpy(table, filter);
        return chain;
      };
      chain.ilike = (...args: unknown[]) => {
        ilikeSpy(table, ...args);
        return chain;
      };
      chain.then = (resolve: (value: unknown) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve);
      return chain;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => createSupabaseMock(),
}));

const { searchSite } = await import("./searchEngine");
const { eitherContains } = await import("./searchUtils");

beforeEach(() => {
  vi.clearAllMocks();
  getUserId.mockResolvedValue("user_123");
});

describe("searchSite", () => {
  it.each([
    ["an ordinary word", "Scarf"],
    ["a text written as conditions of its own", "zzz,price.gt.0,title.ilike.zzz"],
    ["a comma, a full stop, parentheses, a double quote and a backslash", 'Scarf, wool. (red) "large" \\ blue'],
  ])("passes each of the five two-column searches the filter eitherContains() writes, for %s", async (_case, text) => {
    await searchSite(text);

    expect(orSpy.mock.calls).toEqual([
      ["user_profiles", eitherContains("username", "display_name", text)],
      ["wishlist_items", eitherContains("title", "description", text)],
      ["group_gifts", eitherContains("name", "description", text)],
      ["gift_exchanges", eitherContains("name", "description", text)],
      ["tracked_gifts", eitherContains("name", "description", text)],
    ]);
  });

  it("gives an ordinary word the filter that matches it in either column", async () => {
    await searchSite("Scarf");

    expect(orSpy).toHaveBeenCalledWith("wishlist_items", 'title.ilike."%scarf%",description.ilike."%scarf%"');
  });

  it("passes the text to the two one-column searches as a value", async () => {
    await searchSite("Book Club");

    expect(ilikeSpy.mock.calls).toEqual([
      ["group_members", "groups.name", "%book club%"],
      ["gift_recipients", "name", "%book club%"],
    ]);
  });

  it("asks nothing for a text shorter than two characters, or for nobody signed in", async () => {
    expect(await searchSite("a")).toEqual([]);
    getUserId.mockResolvedValue(null);
    expect(await searchSite("Scarf")).toEqual([]);
    expect(orSpy).not.toHaveBeenCalled();
  });
});
