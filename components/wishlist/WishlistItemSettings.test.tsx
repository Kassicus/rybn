// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * The edit dialog sends the item's details as they were when it is saved untouched, and always sends them. These
 * render the real dialog and mock the actions, the router and the signed-in user.
 */

const updateWishlistItem = vi.fn();
vi.mock("@/lib/actions/wishlist", () => ({
  updateWishlistItem: (id: string, data: unknown) => updateWishlistItem(id, data),
  deleteWishlistItem: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null }) }));
// The image picker reaches the storage client, which cannot load in jsdom; no user is signed in here anyway.
vi.mock("@/components/ui/image-input", () => ({ ImageInput: () => null }));
// The privacy selector asks the groups action for the person's groups, which cannot run in jsdom.
vi.mock("@/components/wishlist/WishlistPrivacySelector", () => ({ WishlistPrivacySelector: () => null }));

const { WishlistItemSettings } = await import("./WishlistItemSettings");

const ITEM_ID = "5a1c9e2b-3d4f-4a6b-8c7d-9e0f1a2b3c4d";

const base = {
  title: "Personalized name mug",
  priority: "medium" as const,
  privacy_settings: { visibleToGroupTypes: ["family" as const], restrictToGroup: null },
};

function openEditor(details?: unknown) {
  render(
    <WishlistItemSettings
      itemId={ITEM_ID}
      itemTitle={base.title}
      item={{ ...base, details } as never}
    />
  );
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  fireEvent.click(screen.getByRole("button", { name: "Edit Item" }));
}

const save = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => expect(updateWishlistItem).toHaveBeenCalled());
  return updateWishlistItem.mock.calls[0][1] as { details: unknown };
};

const stored = [
  { kind: "color", value: "Blue" },
  { kind: "other", label: "Name on it", value: "Sam" },
];

beforeEach(() => {
  vi.clearAllMocks();
  updateWishlistItem.mockResolvedValue({ data: {} });
});

afterEach(cleanup);

describe("WishlistItemSettings details", () => {
  it("sends the same details in the same order when saved untouched", async () => {
    openEditor(stored);
    const sent = await save();
    expect(sent.details).toEqual([
      { kind: "color", label: "Color", value: "Blue" },
      { kind: "other", label: "Name on it", value: "Sam" },
    ]);
  });

  it("sends the ones left after removing one", async () => {
    openEditor(stored);
    fireEvent.click(screen.getByRole("button", { name: "Remove Color" }));
    const sent = await save();
    expect(sent.details).toEqual([{ kind: "other", label: "Name on it", value: "Sam" }]);
  });

  it("sends an empty list for an item with no details", async () => {
    openEditor(undefined);
    const sent = await save();
    expect(sent.details).toEqual([]);
  });

  it("shows a detail's refusal under the control", async () => {
    updateWishlistItem.mockResolvedValue({ error: "Give the detail a name." });
    openEditor(stored);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const alerts = await screen.findAllByText("Give the detail a name.");
    expect(alerts).toHaveLength(1);
  });
});
