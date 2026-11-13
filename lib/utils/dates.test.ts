import { describe, it, expect } from "vitest";
import { isCalendarDay } from "./dates";

/**
 * A birthday, an anniversary or a group date is stored as YYYY-MM-DD text and
 * must name a day that exists on the Gregorian calendar.
 */
describe("isCalendarDay", () => {
  it.each(["2024-02-29", "2026-12-25", "1962-01-14", "2000-02-29"])("%s is a day", (text) => {
    expect(isCalendarDay(text)).toBe(true);
  });

  it.each([
    "2026-02-29",
    "2026-02-30",
    "2026-13-01",
    "2026-1-5",
    "",
    "25/12/2026",
    "2100-02-29",
    "2026-04-31",
    "2026-00-10",
    "2026-12-00",
    "0000-01-01",
  ])("%s is not", (text) => {
    expect(isCalendarDay(text)).toBe(false);
  });
});
