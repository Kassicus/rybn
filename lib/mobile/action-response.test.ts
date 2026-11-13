import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  ACTION_FALLBACK,
  NOT_SIGNED_IN,
  NOT_THE_CLAIMER,
  actionAnswer,
  actionFailure,
  databaseFailure,
} from "./action-response";

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

/** The source of one exported function of a server action module, which lib/mobile may not change. */
function actionSource(file: string, name: string): string {
  const text = readFileSync(fileURLToPath(new URL(`../actions/${file}`, import.meta.url)), "utf8");
  const start = text.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = text.indexOf("\nexport ", start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

describe("the site's sentences the routes match", () => {                                          // Minor 6
  it("NOT_THE_CLAIMER is the refusal markAsPurchased answers", () =>
    expect(actionSource("wishlist.ts", "markAsPurchased")).toContain(`error: ${JSON.stringify(NOT_THE_CLAIMER)}`));
});

describe("actionAnswer", () => {
  const answers = { notFound: ["You are not a member of this group"], refusals: ["Only the owner can delete this group"] };

  it("answers 404, saying nothing more, for a sentence the route says is not there", async () => {
    const res = actionAnswer(fail("You are not a member of this group"), "leaveGroup", answers);
    expect([res?.status, await res!.json()]).toEqual([404, { error: { code: "not_found", message: "That isn't there any more." } }]);
  });

  it("answers 422 with the website's words for a sentence the route passes on", async () => {
    const res = actionAnswer(fail("Only the owner can delete this group"), "deleteGroup", answers);
    expect([res?.status, (await res!.json()).error]).toEqual([422, { code: "invalid", message: "Only the owner can delete this group" }]);
  });

  it("answers 401 when signed out, whatever the lists say", () => {
    expect(actionAnswer(fail(NOT_SIGNED_IN), "x", answers)?.status).toBe(401);
    expect(actionAnswer(fail(NOT_SIGNED_IN), "x", { refusals: [NOT_SIGNED_IN] })?.status).toBe(401);
  });

  it("throws, naming the action and its words, for any other error", () => {
    expect(() => actionAnswer(fail("Failed to leave the group. Please try again."), "leaveGroup", answers))
      .toThrow(/^leaveGroup failed: Failed to leave the group\. Please try again\.$/);
    expect(() => actionAnswer({ error: 5 }, "leaveGroup", answers)).toThrow(/leaveGroup failed: 5/);
    expect(() => actionAnswer(fail("Only the owner can delete this group"), "deleteGroup")).toThrow(/deleteGroup failed/);
  });

  it("is null on success", () => {
    expect(actionAnswer(okTrue(), "x", answers)).toBeNull();
    expect(actionAnswer({ data: {}, error: null }, "x", answers)).toBeNull();
  });
});

describe("databaseFailure", () => {
  it("answers 401 when signed out", () => expect(databaseFailure({ error: NOT_SIGNED_IN }, "x")?.status).toBe(401));
  it("throws, naming the action and the database's words, for any other error", () =>
    expect(() => databaseFailure({ error: "relation does not exist" }, "getMyWishlist")).toThrow(/getMyWishlist.*relation does not exist/));
  it("is null on success", () => expect(databaseFailure({ data: [] }, "x")).toBeNull());
});
