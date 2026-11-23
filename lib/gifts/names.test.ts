import { describe, it, expect } from "vitest";
import { byGiftPersonName, forLine, giftPersonName, hiddenLine, joinedNames, neverLine } from "./names";

describe("the words that say who a group gift is for", () => {
  it("joins one, two and three names", () => {
    expect(joinedNames(["Dad"])).toBe("Dad");
    expect(joinedNames(["Mom", "Dad"])).toBe("Mom and Dad");
    expect(joinedNames(["Mom", "Dad", "Gran"])).toBe("Mom, Dad and Gran");
    expect(joinedNames(["Mom", "Dad", "Gran", "Alex Rivera"])).toBe("Mom, Dad, Gran and Alex Rivera");
    expect(joinedNames([])).toBe("");
  });

  it("writes the three lines, and none for nobody", () => {
    expect(forLine(["Dad"])).toBe("For Dad");
    expect(forLine(["Mom", "Dad"])).toBe("For Mom and Dad");
    expect(hiddenLine(["Dad"])).toBe("Dad can't see this gift or its chat.");
    expect(hiddenLine(["Mom", "Dad"])).toBe("They can't see this gift or its chat.");
    expect(neverLine(["Dad"])).toBe("Dad will never see this gift, its pledges or its chat.");
    expect(neverLine(["Mom", "Dad"])).toBe("Mom and Dad will never see this gift, its pledges or its chat.");
    expect(forLine([])).toBeNull();
    expect(hiddenLine([])).toBeNull();
    expect(neverLine([])).toBeNull();
  });

  it("names a person as the app's routes do", () => {
    expect(giftPersonName({ display_name: "Alex Rivera", username: "alex" })).toBe("Alex Rivera");
    expect(giftPersonName({ display_name: null, username: "jordan" })).toBe("jordan");
    expect(giftPersonName({ display_name: "   ", username: "jordan" })).toBe("jordan");
    expect(giftPersonName({ display_name: null, username: null })).toBe("Someone");
    expect(giftPersonName({ display_name: "", username: " " })).toBe("Someone");
  });

  it("orders people by name without regard to case, then by id", () => {
    const person = (id: string, display_name: string | null, username: string | null) => ({ id, display_name, username });
    const people = [
      person("user_3", "Mom", "maria"),
      person("user_2", null, "jordan"),
      person("user_9", "Gran", "gran"),
      person("user_1", "gran", "granny"),
      person("user_5", null, null),
    ];
    expect([...people].sort(byGiftPersonName).map((p) => p.id)).toEqual([
      "user_1", "user_9", "user_2", "user_3", "user_5",
    ]);
  });
});
