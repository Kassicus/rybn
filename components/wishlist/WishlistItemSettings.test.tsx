// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react";

/**
 * The edit dialog sends an item's details only when the person has used the details control; an untouched save
 * carries no `details` key and the server leaves the stored details alone. These
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
  // A price, so the form is valid when the dialog is reopened and saved again (an empty price field reads back as NaN).
  price: 25,
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
  return updateWishlistItem.mock.calls[0][1] as { details?: unknown };
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
  it("says nothing about details when an item with details is saved untouched", async () => {
    openEditor(stored);
    const sent = await save();
    expect("details" in sent).toBe(false);
  });

  it("sends the ones left after removing one", async () => {
    openEditor(stored);
    fireEvent.click(screen.getByRole("button", { name: "Remove Color" }));
    const sent = await save();
    expect(sent.details).toEqual([{ kind: "other", label: "Name on it", value: "Sam" }]);
  });

  it("says nothing about details when an item with none is saved untouched", async () => {
    openEditor(undefined);
    const sent = await save();
    expect("details" in sent).toBe(false);
  });

  it("says nothing about details on a second save after a save that changed them", async () => {
    updateWishlistItem.mockResolvedValue({ data: { details: [{ kind: "other", label: "Name on it", value: "Sam" }] } });
    openEditor(stored);
    fireEvent.click(screen.getByRole("button", { name: "Remove Color" }));
    const first = await save();
    expect(first.details).toEqual([{ kind: "other", label: "Name on it", value: "Sam" }]);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit Item" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Item" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(updateWishlistItem).toHaveBeenCalledTimes(2));
    expect("details" in (updateWishlistItem.mock.calls[1][1] as object)).toBe(false);
  });

  it("shows what was stored after a save, so a dropped empty row is gone on reopening", async () => {
    updateWishlistItem.mockResolvedValue({ data: { details: [] } });
    openEditor(undefined);
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    expect(screen.getByRole("button", { name: "Remove Size" })).toBeTruthy();
    await save();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Edit Item" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit Item" }));
    expect(screen.queryByRole("button", { name: "Remove Size" })).toBeNull();
  });

  it("shows a detail's refusal under the control", async () => {
    updateWishlistItem.mockResolvedValue({ error: "Give the detail a name." });
    openEditor(stored);
    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    const group = await screen.findByRole("group", { name: "Details" });
    const alerts = within(group).getAllByText("Give the detail a name.");
    expect(alerts).toHaveLength(1);
    expect(screen.getAllByText("Give the detail a name.")).toHaveLength(1);
  });
});
