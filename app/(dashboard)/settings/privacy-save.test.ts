import { describe, it, expect } from "vitest";
import { sameKinds, savesPrivacy } from "./privacy-save";

describe("sameKinds", () => {
  it("is true for the same kinds in any order, and false otherwise", () => {
    expect(sameKinds(["family", "work"], ["work", "family"])).toBe(true);
    expect(sameKinds([], [])).toBe(true);
    expect(sameKinds(["family"], ["family", "friends"])).toBe(false);
    expect(sameKinds(["family"], [])).toBe(false);
  });
});

/** Whether the Settings page's Save calls updatePrivacySettings. */
describe("savesPrivacy", () => {
  it("does not save an unchanged choice when every detail already has it", () =>
    expect(savesPrivacy(["family", "friends"], ["friends", "family"], false)).toBe(false));

  it("saves an unchanged choice when some detail has a different setting, so saving sets them all", () =>
    expect(savesPrivacy(["family", "friends"], ["family", "friends"], true)).toBe(true));

  it("saves a changed choice, whether or not some detail has a different setting", () => {
    expect(savesPrivacy(["family"], ["family", "friends"], false)).toBe(true);
    expect(savesPrivacy(["family"], ["family", "friends"], true)).toBe(true);
    expect(savesPrivacy([], ["family"], false)).toBe(true);
  });
});
