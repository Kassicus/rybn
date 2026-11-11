import { describe, it, expect } from "vitest";
import { ACTION_FALLBACK, NOT_SIGNED_IN, actionFailure, databaseFailure } from "./action-response";

// Typed as the unions the real server actions return, so these also prove the signature accepts them.
const ok = (v: boolean): { ok: boolean } | { error: string } => ({ ok: v });
const okTrue = (): { ok: true } | { error: string } => ({ ok: true });
const data = (): { data: string[] } | { error: string } => ({ data: ["a"] });
const fail = (error: string): { ok: boolean } | { error: string } => ({ error });

describe("actionFailure", () => {
  it("answers 401 when the action says nobody is signed in", async () => {
    const res = actionFailure(fail(NOT_SIGNED_IN));
    expect(res?.status).toBe(401);
    expect((await res!.json()).error.code).toBe("unauthorized");
    expect(NOT_SIGNED_IN).toBe("Not authenticated");
  });

  it("answers 422 with the website's own words when the action refuses", async () => {
    const res = actionFailure(fail("Failed to load upcoming occasions."));
    expect(res?.status).toBe(422);
    const { error } = await res!.json();
    expect(error.code).toBe("invalid");
    expect(error.message).toBe("Failed to load upcoming occasions.");
  });

  it("falls back to a general message when the error is empty", async () => {
    const res = actionFailure(fail(""));
    expect(res?.status).toBe(422);
    expect((await res!.json()).error.message).toBe(ACTION_FALLBACK);
  });

  it("falls back to a general message when the error is not a string", async () => {
    const res = actionFailure({ error: 5 });
    expect(res?.status).toBe(422);
    expect((await res!.json()).error.message).toBe(ACTION_FALLBACK);
  });

  it("is null when the action did not fail", () => {
    expect(actionFailure(ok(true))).toBeNull();
    expect(actionFailure(ok(false))).toBeNull();
    expect(actionFailure(okTrue())).toBeNull();
    expect(actionFailure(data())).toBeNull();
    expect(actionFailure({ success: true })).toBeNull();
    expect(actionFailure({})).toBeNull();
  });

  it("treats a null error as success", () => {
    expect(actionFailure({ data: {}, error: null })).toBeNull();
  });
});

describe("databaseFailure", () => {
  it("answers 401 when signed out", () => expect(databaseFailure({ error: NOT_SIGNED_IN }, "x")?.status).toBe(401));
  it("throws, naming the action and the database's words, for any other error", () =>
    expect(() => databaseFailure({ error: "relation does not exist" }, "getMyWishlist")).toThrow(/getMyWishlist.*relation does not exist/));
  it("is null on success", () => expect(databaseFailure({ data: [] }, "x")).toBeNull());
});
