import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/auth/ensure-profile", () => ({ ensureProfile: async () => null }));

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("route-live MOBILE_MIN_BUILD warning", () => {
  it("warns once, naming the value, when it does not parse", async () => {
    vi.stubEnv("MOBILE_MIN_BUILD", "v12");
    await import("./route-live");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"v12"'));
  });

  it("stays quiet when it is unset, blank or a whole number", async () => {
    for (const value of ["", "  ", "12"]) {
      vi.resetModules();
      vi.stubEnv("MOBILE_MIN_BUILD", value);
      await import("./route-live");
    }
    expect(console.warn).not.toHaveBeenCalled();
  });
});
