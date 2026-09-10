import { describe, it, expect } from "vitest";
import {
  ALL_GROUP_TYPES,
  fromStored,
  toStored,
  type PrivacyChoice,
} from "./privacy-choice";

/**
 * These map the form's three plain choices onto the shape the database
 * actually reads. The rule being modelled is can_view_wishlist_item() in the
 * baseline migration:
 *
 *   1. restrictToGroup set  -> ONLY that group can see it; visibleToGroupTypes
 *                              is ignored completely.
 *   2. otherwise types = [] -> nobody.
 *   3. otherwise            -> anyone sharing a group of a listed type.
 *
 * A bug here silently changes who can see somebody's wishlist, which is why
 * this is the piece that gets tests rather than the form around it.
 */

describe("fromStored", () => {
  it("reads all four types as 'everyone in my groups'", () => {
    expect(fromStored({ visibleToGroupTypes: ALL_GROUP_TYPES, restrictToGroup: null }))
      .toEqual({ kind: "groups" });
  });

  it("ignores the order the types are stored in", () => {
    expect(fromStored({ visibleToGroupTypes: ["work", "custom", "family", "friends"], restrictToGroup: null }))
      .toEqual({ kind: "groups" });
  });

  it("reads no types as private", () => {
    expect(fromStored({ visibleToGroupTypes: [], restrictToGroup: null }))
      .toEqual({ kind: "private" });
  });

  it("reads a restriction as one group", () => {
    expect(fromStored({ visibleToGroupTypes: [], restrictToGroup: "g-1" }))
      .toEqual({ kind: "group", groupId: "g-1" });
  });

  it("lets the restriction win over types, as the database does", () => {
    // can_view_wishlist_item returns on restrictToGroup before it ever looks
    // at visibleToGroupTypes, so a row carrying both is a one-group item.
    expect(fromStored({ visibleToGroupTypes: ALL_GROUP_TYPES, restrictToGroup: "g-1" }))
      .toEqual({ kind: "group", groupId: "g-1" });
  });

  it("treats an empty-string restriction as no restriction", () => {
    expect(fromStored({ visibleToGroupTypes: ALL_GROUP_TYPES, restrictToGroup: "" }))
      .toEqual({ kind: "groups" });
  });

  it("surfaces a partial legacy selection rather than pretending it is 'everyone'", () => {
    // Items saved before the type toggles were removed can carry a subset.
    // Reporting that as "everyone in my groups" would widen it the next time
    // the owner edited an unrelated field.
    expect(fromStored({ visibleToGroupTypes: ["family", "friends"], restrictToGroup: null }))
      .toEqual({ kind: "legacyTypes", types: ["family", "friends"] });
  });

  it("normalises duplicates and unknown values out of a legacy selection", () => {
    expect(fromStored({
      visibleToGroupTypes: ["family", "family", "nonsense" as never],
      restrictToGroup: null,
    })).toEqual({ kind: "legacyTypes", types: ["family"] });
  });

  it("treats a list of unknown values as private, not as everyone", () => {
    expect(fromStored({ visibleToGroupTypes: ["nonsense" as never], restrictToGroup: null }))
      .toEqual({ kind: "private" });
  });
});

describe("toStored", () => {
  it("writes all four types for 'everyone in my groups'", () => {
    expect(toStored({ kind: "groups" }))
      .toEqual({ visibleToGroupTypes: ALL_GROUP_TYPES, restrictToGroup: null });
  });

  it("writes nothing visible for private", () => {
    expect(toStored({ kind: "private" }))
      .toEqual({ visibleToGroupTypes: [], restrictToGroup: null });
  });

  it("fails closed when restricting to one group", () => {
    // The database ignores types once restrictToGroup is set, so their value
    // only matters if the restriction is ever cleared. Empty means clearing it
    // makes the item private; all-four would silently publish it.
    expect(toStored({ kind: "group", groupId: "g-1" }))
      .toEqual({ visibleToGroupTypes: [], restrictToGroup: "g-1" });
  });

  it("preserves a legacy selection untouched", () => {
    expect(toStored({ kind: "legacyTypes", types: ["family", "friends"] }))
      .toEqual({ visibleToGroupTypes: ["family", "friends"], restrictToGroup: null });
  });
});

describe("round trip", () => {
  const CHOICES: PrivacyChoice[] = [
    { kind: "groups" },
    { kind: "private" },
    { kind: "group", groupId: "g-1" },
    { kind: "legacyTypes", types: ["family", "work"] },
  ];

  it("survives choice -> stored -> choice for every choice", () => {
    for (const choice of CHOICES) {
      expect(fromStored(toStored(choice))).toEqual(choice);
    }
  });
});
