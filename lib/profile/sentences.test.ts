import { describe, it, expect } from "vitest";
import { VISIBILITY_INVALID as SCHEMA_SENTENCE } from "@/lib/profile/visibility";
import { PROFILE_SENTENCES, VISIBILITY_INVALID } from "./sentences";

describe("the profile and settings actions' sentences", () => {
  // Written out, so changing a single character of one fails here.
  it("are the words the actions answer, character for character", () => {
    expect(PROFILE_SENTENCES).toEqual({ usernameTaken: "Username is already taken" });
    expect(VISIBILITY_INVALID).toBe("Choose which kinds of group can see your details.");
  });

  it("passes on the choice's sentence as it is", () => expect(VISIBILITY_INVALID).toBe(SCHEMA_SENTENCE));
});
