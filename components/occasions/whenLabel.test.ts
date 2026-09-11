import { describe, it, expect } from "vitest";
import { whenLabel } from "./whenLabel";

describe("whenLabel", () => {
  it("labels 0 days as Today", () => {
    expect(whenLabel(0)).toBe("Today");
  });

  it("labels 1 day as Tomorrow", () => {
    expect(whenLabel(1)).toBe("Tomorrow");
  });

  it("labels 7 days as 'in 7 days'", () => {
    expect(whenLabel(7)).toBe("in 7 days");
  });

  // Reachable when the viewer's clock lags the server's -- e.g. the server
  // fetched an occasion for "today" using ITS clock, but the viewer's own
  // clock (which RelativeWhen.tsx feeds into daysUntil) is still a calendar
  // day behind. See whenLabel.ts's doc comment for why "Today" (not a
  // negative number, not "Yesterday") is the honest label here.
  it("labels a negative count as Today rather than a negative number", () => {
    expect(whenLabel(-1)).toBe("Today");
  });
});
