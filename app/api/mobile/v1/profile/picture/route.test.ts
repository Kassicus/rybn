import { describe, it, expect, vi, beforeEach } from "vitest";
import { fixture } from "@/lib/mobile/test-fixtures";
import { PICTURE_MAX_BYTES, PICTURE_RULES } from "@/lib/mobile/picture";

/**
 * POST sets the caller's picture on their sign-in account, then writes the address it answers to avatar_url; DELETE
 * removes it, then clears avatar_url. The sign-in account comes first and the database second, and a failure at either
 * step answers 500, so sending the same request again puts both right.
 *
 * The sign-in provider and the database are fakes: nothing reaches the network.
 */

const ADDRESS = "https://img.clerk.com/sam-new-picture";

/** What the fakes record, in call order: "clerk" for the sign-in account, "database" for the write to user_profiles. */
let order: string[] = [];
/** The database fake's records: each table asked for, each update's payload, each eq, each select's columns. */
let db: { tables: string[]; updates: unknown[]; eqs: [string, unknown][]; selects: string[] };
/** What maybeSingle answers, first in first out; empty, it answers the caller's row. */
let answers: { data: unknown; error: unknown }[] = [];

const setSignInPicture = vi.fn();
const removeSignInPicture = vi.fn();

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => "user_2abcDEF" }));
vi.mock("@/lib/auth/clerk-users", () => ({
  setSignInPicture: (...a: unknown[]) => setSignInPicture(...a),
  removeSignInPicture: (...a: unknown[]) => removeSignInPicture(...a),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      db.tables.push(table);
      return {
        update: (payload: unknown) => {
          order.push("database");
          db.updates.push(payload);
          return {
            eq: (column: string, value: unknown) => {
              db.eqs.push([column, value]);
              return {
                select: (columns: string) => {
                  db.selects.push(columns);
                  return { maybeSingle: async () => answers.shift() ?? { data: { id: "user_2abcDEF" }, error: null } };
                },
              };
            },
          };
        },
      };
    },
  }),
}));

const { POST, DELETE } = await import("./route");
const { bearer } = await import("@/lib/mobile/test-shopping-mocks");

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const url = "http://localhost/api/mobile/v1/profile/picture";
const upload = (type: string, bytes: Uint8Array) =>
  new Request(url, { method: "POST", headers: { authorization: "Bearer t", "content-type": type }, body: bytes as BodyInit });
const remove = () => bearer(url, { method: "DELETE" });
const ctx = { params: Promise.resolve({}) };

/** The one picture the sign-in account was given. */
function sentPicture(): Blob {
  expect(setSignInPicture).toHaveBeenCalledTimes(1);
  const [userId, file] = setSignInPicture.mock.calls[0];
  expect(userId).toBe("user_2abcDEF");
  expect(file).toBeInstanceOf(Blob);
  return file as Blob;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MOBILE_MIN_BUILD", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  order = [];
  db = { tables: [], updates: [], eqs: [], selects: [] };
  answers = [];
  setSignInPicture.mockImplementation(async () => {
    order.push("clerk");
    return ADDRESS;
  });
  removeSignInPicture.mockImplementation(async () => {
    order.push("clerk");
  });
});

describe("POST and DELETE /api/mobile/v1/profile/picture", () => {
  it("sets the picture on the sign-in account, then writes its address, and answers the fixture", async () => {
    const res = await POST(upload("image/jpeg", JPEG), ctx);

    expect([res.status, res.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect(await res.json()).toEqual(fixture("profile-picture"));
    const file = sentPicture();
    expect([file.type, file.size]).toEqual(["image/jpeg", JPEG.length]);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(JPEG);
    expect(db.tables).toEqual(["user_profiles"]);
    expect(db.updates).toEqual([{ avatar_url: ADDRESS }]);
    expect(db.eqs).toEqual([["id", "user_2abcDEF"]]);
    expect(db.selects).toEqual(["id"]);
    expect(order).toEqual(["clerk", "database"]);
  });

  it("takes a PNG", async () => {
    const res = await POST(upload("image/png", PNG), ctx);

    expect(res.status).toBe(200);
    const file = sentPicture();
    expect([file.type, file.size]).toEqual(["image/png", PNG.length]);
    expect(db.updates).toEqual([{ avatar_url: ADDRESS }]);
  });

  it("refuses another type, a picture over 4 MB, or bytes that don't match, with the picture routes' sentences, changing nothing", async () => {
    const big = new Uint8Array(PICTURE_MAX_BYTES + 1);
    big.set(JPEG);
    const cases: [Request, string][] = [
      [upload("image/gif", JPEG), PICTURE_RULES.type],
      [upload("image/jpeg", big), PICTURE_RULES.size],
      [upload("image/png", JPEG), PICTURE_RULES.bytes],
    ];
    for (const [request, message] of cases) {
      const res = await POST(request, ctx);
      expect(res.status).toBe(422);
      expect((await res.json()).error).toEqual({ code: "invalid", message });
    }
    expect(setSignInPicture).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });

  it("answers 500 and writes nothing when the sign-in provider refuses", async () => {
    setSignInPicture.mockRejectedValueOnce(new Error("Unprocessable Entity: image too wide"));

    const res = await POST(upload("image/jpeg", JPEG), ctx);

    const text = await res.text();
    expect([res.status, JSON.parse(text).error.code]).toEqual([500, "server_error"]);
    expect(text).not.toMatch(/Unprocessable|too wide/);
    expect(db.updates).toEqual([]);
  });

  it("answers 500 when the address cannot be written, and sending again puts it right", async () => {
    answers.push({ data: null, error: { message: "boom" } });

    const failed = await POST(upload("image/jpeg", JPEG), ctx);

    const text = await failed.text();
    expect([failed.status, JSON.parse(text).error.code]).toEqual([500, "server_error"]);
    expect(text).not.toMatch(/boom/);

    const again = await POST(upload("image/jpeg", JPEG), ctx);

    expect(again.status).toBe(200);
    expect(await again.json()).toEqual(fixture("profile-picture"));
    expect(db.updates).toEqual([{ avatar_url: ADDRESS }, { avatar_url: ADDRESS }]);
    expect(order).toEqual(["clerk", "database", "clerk", "database"]);
  });

  it("answers 500 when no row was written", async () => {
    answers.push({ data: null, error: null });

    const res = await POST(upload("image/jpeg", JPEG), ctx);

    expect([res.status, (await res.json()).error.code]).toEqual([500, "server_error"]);
  });

  it("removes the sign-in account's picture, then clears the address, and answers 204", async () => {
    const res = await DELETE(remove(), ctx);

    expect([res.status, res.headers.get("cache-control")]).toEqual([204, "no-store"]);
    expect(await res.text()).toBe("");
    expect(removeSignInPicture.mock.calls).toEqual([["user_2abcDEF"]]);
    expect(db.tables).toEqual(["user_profiles"]);
    expect(db.updates).toEqual([{ avatar_url: null }]);
    expect(db.eqs).toEqual([["id", "user_2abcDEF"]]);
    expect(db.selects).toEqual(["id"]);
    expect(order).toEqual(["clerk", "database"]);
  });

  it("answers 500 when either removal fails, and a second DELETE finishes", async () => {
    removeSignInPicture.mockRejectedValueOnce(new Error("Internal Server Error"));

    const clerkFailed = await DELETE(remove(), ctx);

    expect([clerkFailed.status, (await clerkFailed.json()).error.code]).toEqual([500, "server_error"]);
    expect(db.updates).toEqual([]);
    expect([(await DELETE(remove(), ctx)).status, db.updates]).toEqual([204, [{ avatar_url: null }]]);

    answers.push({ data: null, error: { message: "boom" } });

    const databaseFailed = await DELETE(remove(), ctx);

    const text = await databaseFailed.text();
    expect([databaseFailed.status, JSON.parse(text).error.code]).toEqual([500, "server_error"]);
    expect(text).not.toMatch(/boom/);
    expect((await DELETE(remove(), ctx)).status).toBe(204);
    expect(removeSignInPicture).toHaveBeenCalledTimes(4);
    expect(db.updates).toEqual([{ avatar_url: null }, { avatar_url: null }, { avatar_url: null }]);
  });

  it("answers 401 without a bearer, changing nothing", async () => {
    const posted = await POST(new Request(url, { method: "POST", headers: { "content-type": "image/jpeg" }, body: JPEG as BodyInit }), ctx);
    const deleted = await DELETE(new Request(url, { method: "DELETE" }), ctx);

    expect([posted.status, deleted.status]).toEqual([401, 401]);
    expect(setSignInPicture).not.toHaveBeenCalled();
    expect(removeSignInPicture).not.toHaveBeenCalled();
    expect(db.updates).toEqual([]);
  });
});
