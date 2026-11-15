import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * deleteSignInAccount deletes the person's sign-in account. A sign-in account
 * that is already gone (a first try deleted it) counts as deleted, so trying
 * again finishes; any other failure is thrown to the caller.
 *
 * The sign-in provider's client is a fake: nothing reaches the network.
 */
const deleteUser = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({ users: { deleteUser: (...args: unknown[]) => deleteUser(...args) } }),
}));

const { deleteSignInAccount } = await import("./clerk-users");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteSignInAccount", () => {
  it("deletes the sign-in account by its id", async () => {
    deleteUser.mockResolvedValue({ id: "user_2abcDEF" });

    await expect(deleteSignInAccount("user_2abcDEF")).resolves.toBeUndefined();

    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith("user_2abcDEF");
  });

  it("counts a sign-in account already deleted by a first tap as deleted", async () => {
    deleteUser.mockRejectedValue(new ClerkAPIResponseError("Not Found", { data: [], status: 404 }));

    await expect(deleteSignInAccount("user_2abcDEF")).resolves.toBeUndefined();

    expect(deleteUser).toHaveBeenCalledWith("user_2abcDEF");
  });

  it("throws any other failure", async () => {
    const serverError = new ClerkAPIResponseError("Internal Server Error", { data: [], status: 500 });
    deleteUser.mockRejectedValueOnce(serverError);

    await expect(deleteSignInAccount("user_2abcDEF")).rejects.toBe(serverError);

    const networkError = new Error("fetch failed");
    deleteUser.mockRejectedValueOnce(networkError);

    await expect(deleteSignInAccount("user_2abcDEF")).rejects.toBe(networkError);
  });
});
