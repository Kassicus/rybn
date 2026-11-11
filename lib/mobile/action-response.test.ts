import { describe, it, expect } from "vitest";
import { ACTION_FALLBACK, NOT_SIGNED_IN, actionFailure } from "./action-response";

describe("actionFailure", () => {
  it("answers 401 when the action says nobody is signed in", async () => {
    const res = actionFailure({ error: NOT_SIGNED_IN });
    expect(res?.status).toBe(401);
    expect((await res!.json()).error.code).toBe("unauthorized");
    expect(NOT_SIGNED_IN).toBe("Not authenticated");
  });

  it("answers 422 with the website's own words when the action refuses", async () => {
    const res = actionFailure({ error: "Failed to load upcoming occasions." });
    expect(res?.status).toBe(422);
    const { error } = await res!.json();
    expect(error.code).toBe("invalid");
    expect(error.message).toBe("Failed to load upcoming occasions.");
  });

  it("falls back to a general message when the error is empty", async () => {
    const res = actionFailure({ error: "" });
    expect(res?.status).toBe(422);
    expect((await res!.json()).error.message).toBe(ACTION_FALLBACK);
  });

  it("is null when the action did not fail", () => {
    expect(actionFailure({ data: [] } as { error?: string })).toBeNull();
    expect(actionFailure({ success: true } as { error?: string })).toBeNull();
    expect(actionFailure({ ok: false } as { error?: string })).toBeNull();
    expect(actionFailure({})).toBeNull();
  });
});
