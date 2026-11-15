// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup, act, within } from "@testing-library/react";

/**
 * Settings' Delete account: what it removes, a question before anything is
 * deleted, then the website's own deleteAccount. These render the real
 * section and mock only the server action and the sign-in provider.
 */

const deleteAccount = vi.fn();
const signOut = vi.fn();
vi.mock("@/lib/actions/account", () => ({ deleteAccount: () => deleteAccount() }));
vi.mock("@clerk/nextjs", () => ({ useClerk: () => ({ signOut }) }));

const { DeleteAccountSection } = await import("./delete-account-section");

const QUESTION = "Delete your account? This can't be undone.";
const DELETE_FAILED = "Couldn't delete your account. Please try again.";

/** Opens the question and returns its panel. */
const ask = () => {
  fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
  return screen.getByRole("dialog", { name: QUESTION });
};
const confirmButton = (question: HTMLElement) =>
  within(question).getByRole("button", { name: "Delete account" }) as HTMLButtonElement;
const cancelButton = (question: HTMLElement) =>
  within(question).getByRole("button", { name: "Cancel" }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DeleteAccountSection", () => {
  it("says what is removed and how to leave Sign in with Apple", () => {
    render(<DeleteAccountSection />);
    expect(screen.getByRole("heading", { name: "Delete account" })).toBeTruthy();
    expect(
      screen.getByText(
        "Your profile, wishlist, pictures and gift tracker are removed, and your claims are released. Groups you own pass to the member who has been there longest. This can't be undone."
      )
    ).toBeTruthy();
    expect(
      screen.getByText(
        "If you signed in with Apple, you can also remove Rybn under Sign in with Apple in your Apple Account settings."
      )
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete my account" })).toBeTruthy();
  });

  it("asks before deleting, and Cancel deletes nothing", () => {
    render(<DeleteAccountSection />);
    expect(screen.queryByText(QUESTION)).toBeNull();

    const question = ask();
    expect(within(question).getByText(QUESTION)).toBeTruthy();
    expect(confirmButton(question)).toBeTruthy();

    fireEvent.click(within(question).getByRole("button", { name: "Cancel" }));
    expect(deleteAccount).not.toHaveBeenCalled();
    expect(screen.queryByText(QUESTION)).toBeNull();
  });

  it("signs out and goes to the front page once the account is deleted", async () => {
    deleteAccount.mockResolvedValue({ success: true });
    render(<DeleteAccountSection />);

    fireEvent.click(confirmButton(ask()));

    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
    expect(deleteAccount).toHaveBeenCalledTimes(1);
  });

  it("shows the action's sentence when it fails, and stays signed in", async () => {
    deleteAccount.mockResolvedValue({ error: DELETE_FAILED });
    render(<DeleteAccountSection />);

    const question = ask();
    fireEvent.click(confirmButton(question));

    expect(await within(question).findByText(DELETE_FAILED)).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
    // Trying again finishes what is left, so the button works again.
    expect(confirmButton(question).disabled).toBe(false);
  });

  it("shows the same sentence when the request itself fails, and can be tried again", async () => {
    deleteAccount.mockRejectedValueOnce(new Error("Failed to fetch")).mockResolvedValueOnce({ success: true });
    render(<DeleteAccountSection />);

    const question = ask();
    fireEvent.click(confirmButton(question));

    expect(await within(question).findByText(DELETE_FAILED)).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();

    fireEvent.click(confirmButton(question));
    await waitFor(() => expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/" }));
    expect(deleteAccount).toHaveBeenCalledTimes(2);
  });

  it("sends one request at a time", async () => {
    let finish: (result: { success: true }) => void = () => {};
    deleteAccount.mockImplementation(
      () => new Promise((resolve) => {
        finish = resolve;
      })
    );
    render(<DeleteAccountSection />);

    const confirm = confirmButton(ask());
    // Both clicks land before React renders again, so the button is not yet
    // disabled for the second one.
    act(() => {
      confirm.click();
      confirm.click();
    });
    expect(deleteAccount).toHaveBeenCalledTimes(1);

    // Once rendered, it is disabled while the request runs.
    expect(confirm.disabled).toBe(true);
    fireEvent.click(confirm);
    expect(deleteAccount).toHaveBeenCalledTimes(1);

    await act(async () => finish({ success: true }));
    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it("keeps the question up until the deletion has answered", async () => {
    let answer: (result: { error: string }) => void = () => {};
    deleteAccount.mockImplementation(
      () => new Promise((resolve) => {
        answer = resolve;
      })
    );
    render(<DeleteAccountSection />);

    const question = ask();
    fireEvent.click(confirmButton(question));
    expect(cancelButton(question).disabled).toBe(true);
    fireEvent.click(cancelButton(question));
    expect(screen.getByText(QUESTION)).toBeTruthy();

    // A deletion that stopped half way says so in the panel, which is still open.
    await act(async () => answer({ error: DELETE_FAILED }));
    const stillOpen = screen.getByRole("dialog", { name: QUESTION });
    expect(within(stillOpen).getByText(DELETE_FAILED)).toBeTruthy();
    expect(cancelButton(stillOpen).disabled).toBe(false);
  });

  it("goes to the front page when signing out fails after the account is deleted", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    deleteAccount.mockResolvedValue({ success: true });
    signOut.mockRejectedValue(new Error("Failed to fetch"));
    render(<DeleteAccountSection />);

    fireEvent.click(confirmButton(ask()));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/"));
    expect(signOut).toHaveBeenCalledWith({ redirectUrl: "/" });
  });

  it("starts fresh each time the question opens", async () => {
    deleteAccount.mockResolvedValue({ error: DELETE_FAILED });
    render(<DeleteAccountSection />);

    const question = ask();
    fireEvent.click(confirmButton(question));
    expect(await within(question).findByText(DELETE_FAILED)).toBeTruthy();
    fireEvent.click(cancelButton(question));
    expect(screen.queryByText(QUESTION)).toBeNull();

    ask();
    expect(screen.queryByText(DELETE_FAILED)).toBeNull();
  });

  it("puts the keyboard on Cancel when the question opens", () => {
    render(<DeleteAccountSection />);
    const question = ask();
    expect(document.activeElement).toBe(cancelButton(question));
  });
});
