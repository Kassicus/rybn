// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

/**
 * The add page hands the rows of its Details control to createWishlistItem as they are. These render the real page
 * and mock the action, the router, the signed-in user and the pieces that cannot run in jsdom.
 */

const createWishlistItem = vi.fn();
vi.mock("@/lib/actions/wishlist", () => ({
  createWishlistItem: (data: unknown) => createWishlistItem(data),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@clerk/nextjs", () => ({ useUser: () => ({ user: null }) }));
vi.mock("@/components/ui/image-input", () => ({ ImageInput: () => null }));
vi.mock("@/components/wishlist/WishlistPrivacySelector", () => ({ WishlistPrivacySelector: () => null }));
vi.mock("@/components/layout/BreadcrumbSetter", () => ({ BreadcrumbSetter: () => null }));

const { default: AddWishlistItemPage } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  createWishlistItem.mockResolvedValue({ data: {} });
});

afterEach(cleanup);

describe("the add page's details", () => {
  it("sends the rows it holds as details", async () => {
    render(<AddWishlistItemPage />);
    fireEvent.change(screen.getByPlaceholderText("What is it?"), { target: { value: "Water bottle" } });
    fireEvent.click(screen.getByRole("button", { name: "Add details" }));
    fireEvent.click(screen.getByRole("button", { name: "Size" }));
    fireEvent.change(screen.getByLabelText("Size"), { target: { value: "M" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to wishlist" }));

    await waitFor(() => expect(createWishlistItem).toHaveBeenCalled());
    expect(createWishlistItem.mock.calls[0][0].details).toEqual([{ kind: "size", label: "Size", value: "M" }]);
  });
});
