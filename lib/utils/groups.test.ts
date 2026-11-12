import { describe, it, expect } from "vitest";
import { tidyInviteCode } from "./groups";

/**
 * The one tidying rule for an invite code, shared by the website's join box
 * and joinGroupByCode: upper case, letters and digits only, and the dashes put
 * back when exactly nine are left. Anything else is passed on as stripped, for
 * the database to refuse.
 */
describe("tidyInviteCode", () => {
  it.each([
    ["abc def ghi", "ABC-DEF-GHI"],
    ["ABC-DEF-GHI", "ABC-DEF-GHI"],
    [" abcdefghi\n", "ABC-DEF-GHI"],
    ["k7p-mxr-4tq", "K7P-MXR-4TQ"],
    ["abc", "ABC"],
    ["abc-def-ghij", "ABCDEFGHIJ"],
    ["", ""],
  ])("tidies %j as %j", (raw, tidy) => {
    expect(tidyInviteCode(raw)).toBe(tidy);
  });
});
