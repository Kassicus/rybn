import { describe, it, expect, vi, beforeEach } from "vitest";
import { ClerkAPIResponseError } from "@clerk/nextjs/errors";

/**
 * deleteSignInAccount deletes the person's sign-in account. A sign-in account
 * that is already gone (a first try deleted it) counts as deleted, so trying
 * again finishes; any other failure is thrown to the caller.
 *
 * setSignInPicture sets the picture on the sign-in account and answers the
 * address the provider gives for it; removeSignInPicture removes it, counting
 * one already gone as removed, so a second try finishes.
 *
 * The sign-in provider's client is a fake: nothing reaches the network.
 */
const deleteUser = vi.fn();
const updateUserProfileImage = vi.fn();
const deleteUserProfileImage = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: async () => ({
    users: {
      deleteUser: (...args: unknown[]) => deleteUser(...args),
      updateUserProfileImage: (...args: unknown[]) => updateUserProfileImage(...args),
      deleteUserProfileImage: (...args: unknown[]) => deleteUserProfileImage(...args),
    },
  }),
}));

const { deleteSignInAccount, setSignInPicture, removeSignInPicture } = await import("./clerk-users");

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

describe("setSignInPicture", () => {
  it("sets the picture and answers the address that comes back", async () => {
    updateUserProfileImage.mockResolvedValue({ id: "user_2abcDEF", imageUrl: "https://img.clerk.com/sam-new-picture" });
    const file = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], { type: "image/jpeg" });

    await expect(setSignInPicture("user_2abcDEF", file)).resolves.toBe("https://img.clerk.com/sam-new-picture");

    expect(updateUserProfileImage).toHaveBeenCalledTimes(1);
    expect(updateUserProfileImage).toHaveBeenCalledWith("user_2abcDEF", { file });
    expect(updateUserProfileImage.mock.calls[0][1].file).toBe(file);
  });

  it("throws any failure, a 404 too", async () => {
    const notFound = new ClerkAPIResponseError("Not Found", { data: [], status: 404 });
    updateUserProfileImage.mockRejectedValueOnce(notFound);

    await expect(setSignInPicture("user_2abcDEF", new Blob([]))).rejects.toBe(notFound);

    const networkError = new Error("fetch failed");
    updateUserProfileImage.mockRejectedValueOnce(networkError);

    await expect(setSignInPicture("user_2abcDEF", new Blob([]))).rejects.toBe(networkError);
  });
});

describe("removeSignInPicture", () => {
  it("removes the picture, counting one already gone as removed", async () => {
    deleteUserProfileImage.mockResolvedValueOnce({ id: "user_2abcDEF", imageUrl: "https://img.clerk.com/default" });

    await expect(removeSignInPicture("user_2abcDEF")).resolves.toBeUndefined();

    deleteUserProfileImage.mockRejectedValueOnce(new ClerkAPIResponseError("Not Found", { data: [], status: 404 }));

    await expect(removeSignInPicture("user_2abcDEF")).resolves.toBeUndefined();

    const serverError = new ClerkAPIResponseError("Internal Server Error", { data: [], status: 500 });
    deleteUserProfileImage.mockRejectedValueOnce(serverError);

    await expect(removeSignInPicture("user_2abcDEF")).rejects.toBe(serverError);

    const networkError = new Error("fetch failed");
    deleteUserProfileImage.mockRejectedValueOnce(networkError);

    await expect(removeSignInPicture("user_2abcDEF")).rejects.toBe(networkError);

    expect(deleteUserProfileImage.mock.calls).toEqual([["user_2abcDEF"], ["user_2abcDEF"], ["user_2abcDEF"], ["user_2abcDEF"]]);
  });
});
