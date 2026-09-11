import { describe, it, expect } from "vitest";
import { partitionByOccasion, itemsTaggedFor } from "./order";

const items = [{ id: "a" }, { id: "b" }, { id: "c" }];

describe("partitionByOccasion", () => {
  it("puts tagged items first and keeps the rest in their given order", () => {
    const { tagged, rest } = partitionByOccasion(items, new Set(["b"]));
    expect(tagged).toEqual([{ id: "b" }]);
    expect(rest).toEqual([{ id: "a" }, { id: "c" }]);
  });

  // The spec's rule: untagged means "for any occasion", never "hide me".
  it("returns everything when nothing is tagged", () => {
    const { tagged, rest } = partitionByOccasion(items, new Set());
    expect(tagged).toEqual([]);
    expect(rest).toEqual(items);
  });

  // Order within each partition must survive, because the caller has already
  // applied the viewer's chosen sort and this only re-groups.
  it("preserves relative order within each partition", () => {
    const { tagged } = partitionByOccasion(items, new Set(["c", "a"]));
    expect(tagged).toEqual([{ id: "a" }, { id: "c" }]);
  });
});

describe("itemsTaggedFor", () => {
  const tags = { a: ["occ-1"], b: ["occ-1", "occ-2"], c: ["occ-2"] };

  it("selects only items tagged for the occasion in view", () => {
    expect(itemsTaggedFor(tags, "occ-1")).toEqual(new Set(["a", "b"]));
  });

  // The failure this function exists to prevent: treating "has any tag" as
  // "is for this occasion" would put c in the set while viewing occ-1.
  it("excludes items tagged only for a different occasion", () => {
    expect(itemsTaggedFor(tags, "occ-1").has("c")).toBe(false);
  });

  // A derived birthday nobody has tagged anything for was never materialized,
  // so it has no id -- and nothing can be tagged for it. The list must then
  // render exactly as it did before this feature existed.
  it("returns an empty set for an unmaterialized occasion", () => {
    expect(itemsTaggedFor(tags, null)).toEqual(new Set());
  });

  it("returns an empty set when the item has no tags at all", () => {
    expect(itemsTaggedFor({}, "occ-1")).toEqual(new Set());
  });
});
