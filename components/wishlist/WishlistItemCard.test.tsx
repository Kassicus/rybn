// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

/**
 * The card shows an item's details as one line of plain text. The claim and occasion controls reach server actions
 * and the router, which cannot run in jsdom, and neither is drawn here (an owner's list with no occasions).
 */

vi.mock("./ClaimActions", () => ({ ClaimActions: () => null }));
vi.mock("./ItemOccasionTags", () => ({ ItemOccasionTags: () => null }));

const { WishlistItemCard } = await import("./WishlistItemCard");

afterEach(cleanup);

const item = {
  id: "5a1c9e2b-3d4f-4a6b-8c7d-9e0f1a2b3c4d",
  title: "Personalized name mug",
  priority: "medium" as const,
  privacy_settings: { visibleToGroupTypes: ["family" as const], restrictToGroup: null },
};

describe("WishlistItemCard details", () => {
  it("shows the item's details as one line", () => {
    render(
      <WishlistItemCard
        item={{
          ...item,
          details: [
            { kind: "size", value: "M" },
            { kind: "other", label: "Scent", value: "Unscented" },
          ],
        }}
        isOwnWishlist
      />
    );
    expect(screen.getByText("Size M · Scent Unscented")).toBeTruthy();
  });

  it("shows no line for an item with no details", () => {
    render(<WishlistItemCard item={{ ...item, details: [] }} isOwnWishlist />);
    expect(screen.queryByText(/Size/)).toBeNull();
  });
});
