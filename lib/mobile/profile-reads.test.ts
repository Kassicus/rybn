import { describe, it, expect, vi, beforeEach } from "vitest";
import { MOM_ROW } from "./test-profile";

const fromSpy = vi.fn();
const selectSpy = vi.fn();
const eqSpy = vi.fn();
const maybeSingleSpy = vi.fn();
/** What a query awaited without maybeSingle (a list) answers. */
const listSpy = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (...args: unknown[]) => {
      fromSpy(...args);
      const chain = {
        select: (...a: unknown[]) => {
          selectSpy(...a);
          return chain;
        },
        eq: (...a: unknown[]) => {
          eqSpy(...a);
          return chain;
        },
        maybeSingle: () => maybeSingleSpy(),
        then: (resolve: (r: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(listSpy()).then(resolve, reject),
      };
      return chain;
    },
  }),
}));

const { personProfileRows } = await import("./profile-reads");

const MOM = MOM_ROW.id;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a person's profile, as the caller's own client reads it", () => {
  it("reads a person's named columns and their fields with the caller's client", async () => {
    // Even were a row to come back with more columns, only the named ones are passed on.
    maybeSingleSpy.mockResolvedValue({ data: { ...MOM_ROW, email: "mom@example.com" }, error: null });
    listSpy.mockReturnValue({
      data: [{ category: "sizes", field_name: "ring_size", field_value: "7", privacy_settings: { visibleToGroupTypes: ["family"] } }],
      error: null,
    });
    expect(await personProfileRows(MOM)).toEqual({
      row: { id: MOM, username: "maria", display_name: "Mom", avatar_url: "https://img.clerk.com/mom", bio: MOM_ROW.bio },
      info: [{ category: "sizes", field_name: "ring_size", field_value: "7" }],
    });
    expect(JSON.stringify(await personProfileRows(MOM))).not.toMatch(/email|privacy/);
    expect(fromSpy.mock.calls.slice(0, 2)).toEqual([["user_profiles"], ["profile_info"]]);
    expect(selectSpy.mock.calls.slice(0, 2)).toEqual([["id, username, display_name, avatar_url, bio"], ["category, field_name, field_value"]]);
    expect(eqSpy.mock.calls.slice(0, 2)).toEqual([["id", MOM], ["user_id", MOM]]);
  });

  it("answers no fields when row-level security returns none", async () => {
    maybeSingleSpy.mockResolvedValue({ data: { ...MOM_ROW }, error: null });
    listSpy.mockReturnValue({ data: null, error: null });
    expect((await personProfileRows(MOM)).info).toEqual([]);
  });

  it("answers no row for a person the caller cannot see, and throws on a database error", async () => {
    maybeSingleSpy.mockResolvedValue({ data: null, error: null });
    expect(await personProfileRows(MOM)).toEqual({ row: null, info: [] });
    // Nothing more is asked about someone the caller cannot see.
    expect(fromSpy.mock.calls).toEqual([["user_profiles"]]);

    maybeSingleSpy.mockResolvedValue({ data: null, error: { code: "XX000", message: "boom" } });
    await expect(personProfileRows(MOM)).rejects.toThrow(/^personProfileRows failed: boom$/);
    await expect(personProfileRows(MOM)).rejects.toMatchObject({ code: "XX000" });

    maybeSingleSpy.mockResolvedValue({ data: { ...MOM_ROW }, error: null });
    listSpy.mockReturnValue({ data: null, error: { code: "42P01", message: "no fields" } });
    await expect(personProfileRows(MOM)).rejects.toThrow(/^personProfileRows failed: no fields$/);
    await expect(personProfileRows(MOM)).rejects.toMatchObject({ code: "42P01" });
  });
});
