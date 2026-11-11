import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { meResponse } from "./me";

const fixture = JSON.parse(readFileSync("lib/mobile/fixtures/me.json", "utf8"));

describe("meResponse", () => {
  it("matches the contract fixture", () => {
    expect(
      meResponse({
        id: "user_2abcDEF",
        username: "sam",
        display_name: "Sam Rivera",
        email: "sam@example.com",
        avatar_url: "https://img.clerk.com/abc",
      })
    ).toEqual(fixture);
  });

  it("passes nulls through", () => {
    const { user } = meResponse({ id: "user_1", username: null, display_name: null, email: null, avatar_url: null });
    expect(user.username).toBeNull();
    expect(user.displayName).toBeNull();
    expect(user.email).toBeNull();
    expect(user.avatarUrl).toBeNull();
  });

  it("sends exactly five fields", () => {
    const result = meResponse({ id: "user_1", username: "a", display_name: "A", email: "a@b.c", avatar_url: "u" });
    expect(Object.keys(result.user).sort()).toEqual(["avatarUrl", "displayName", "email", "id", "username"]);
  });
});
