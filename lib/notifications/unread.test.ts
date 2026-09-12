import { describe, it, expect } from "vitest";
import { unreadCount, unreadReminders, isIncomingAnniversaryRequest } from "./unread";
import type { AnniversaryLink } from "@/lib/actions/anniversary-links";

const anniversaryLink = (
  overrides: Partial<AnniversaryLink> = {},
): AnniversaryLink => ({
  id: "link-1",
  partnerId: "partner-1",
  partnerUsername: "partner",
  partnerDisplayName: "Partner Name",
  status: "pending",
  agreedDate: "2020-06-01",
  initiatedByMe: false,
  ...overrides,
});

/**
 * Small surface, but it is the one deciding whether the bell's badge tells the
 * truth -- and the badge's previous behaviour was to render unconditionally,
 * claiming unread items whether or not any existed.
 */
describe("unreadCount", () => {
  const reminder = (banner_dismissed: boolean) => ({ banner_dismissed });

  it("counts only reminders the user has not dismissed", () => {
    // What would make this fail: counting raw `.length`, which is the obvious
    // implementation and the wrong one -- getActiveDateReminders() returns
    // today's reminders INCLUDING dismissed ones, because DateReminderBanner
    // does its own filtering at render time. A badge over-reporting this way
    // would re-light the moment a user dismissed a banner, which is precisely
    // the "claims something to see when there isn't" behaviour being fixed.
    // What this does NOT catch: whether banner_dismissed is the right notion
    // of "read" in the first place -- that is a product decision, not a bug
    // this function can have.
    expect(
      unreadCount([reminder(false), reminder(true), reminder(false)]),
    ).toBe(2);
  });

  it("returns 0 for an empty list, null, or undefined", () => {
    // The layout passes whatever getActiveDateReminders() returned, and every
    // one of its error paths returns `{ data: [] }` while a caller destructuring
    // a failed result can still land on undefined. Zero is the safe answer in
    // all three cases: no badge rather than a badge with nothing behind it.
    expect(unreadCount([])).toBe(0);
    expect(unreadCount(null)).toBe(0);
    expect(unreadCount(undefined)).toBe(0);
  });

  it("preserves the rows it keeps, so the page can render them", () => {
    // unreadReminders is the same filter the count is built on; the page uses
    // the rows, the badge uses the length. What would make this fail: filtering
    // on the wrong polarity, which would show exactly the already-read ones.
    const rows = [
      { notification_id: "a", banner_dismissed: false },
      { notification_id: "b", banner_dismissed: true },
    ];
    expect(unreadReminders(rows)).toEqual([
      { notification_id: "a", banner_dismissed: false },
    ]);
  });

  // Falsifiability: change `!link.initiatedByMe` to `link.initiatedByMe` (or
  // drop the status check) and this fails -- a request the caller sent
  // themselves, or one flip of the polarity, would add to a count meant to
  // speak only for things the caller still has to act on.
  it("adds one for an incoming pending anniversary request", () => {
    expect(unreadCount([], anniversaryLink())).toBe(1);
    expect(
      unreadCount([reminder(false)], anniversaryLink()),
    ).toBe(2);
  });

  it("does not count a pending request the caller sent themselves", () => {
    expect(unreadCount([], anniversaryLink({ initiatedByMe: true }))).toBe(0);
  });

  it("does not count a confirmed link -- nothing left to act on", () => {
    expect(unreadCount([], anniversaryLink({ status: "confirmed" }))).toBe(0);
  });

  it("does not count when there is no link at all", () => {
    expect(unreadCount([], null)).toBe(0);
    expect(unreadCount([])).toBe(0);
  });
});

describe("isIncomingAnniversaryRequest", () => {
  it("is true only for a pending link the caller did not initiate", () => {
    expect(isIncomingAnniversaryRequest(anniversaryLink())).toBe(true);
    expect(
      isIncomingAnniversaryRequest(anniversaryLink({ initiatedByMe: true })),
    ).toBe(false);
    expect(
      isIncomingAnniversaryRequest(anniversaryLink({ status: "confirmed" })),
    ).toBe(false);
    expect(isIncomingAnniversaryRequest(null)).toBe(false);
    expect(isIncomingAnniversaryRequest(undefined)).toBe(false);
  });
});
