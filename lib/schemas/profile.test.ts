import { describe, it, expect } from "vitest";
import type { z } from "zod";
import { PROFILE_SECTIONS, fieldSpec } from "@/lib/profile/fields";
import { profileEditSchema } from "./profile";

/**
 * What profile text may hold. The website's edit form draws the bio and three longer fields as a textarea, and every
 * other text field and the display name as a one-line input: one-line text may hold no control character, and free
 * text may hold a tab, a line feed and a carriage return but no other. Both refuse with the sentence the app's rules
 * at the door answer.
 */

const SENTENCE = "That has characters Rybn can't save. Try typing it again.";
const FREE_TEXT = ["bio", "hobbies", "interests", "dislikes"];
const ONE_LINE = [
  "display_name",
  ...PROFILE_SECTIONS.flatMap((s) => s.fields.filter((f) => f.kind === "text").map((f) => f.name as string)),
].filter((name) => !FREE_TEXT.includes(name));

const shape = profileEditSchema.shape as unknown as Record<string, z.ZodType>;
const firstMessage = (name: string, value: string) => shape[name].safeParse(value).error?.issues[0]?.message;

describe("profile text's characters", () => {
  it("draws the line between one-line and free text as the website's form does", () => {
    expect(ONE_LINE).toEqual([
      "display_name",
      "shoe_size", "shirt_size", "pants_size", "dress_size", "ring_size", "hat_size",
      "favorite_colors", "favorite_brands", "style_preferences",
      "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_accessories_needed",
      "dietary_restrictions", "allergies", "coffee_order", "favorite_restaurant", "favorite_snacks",
    ]);
  });

  it.each(ONE_LINE)("refuses any control character in %s", (name) => {
    for (const value of ["a\u0000b", "a\tb", "a\nb", "a\rb", "a\u001Fb", "a\u007Fb"]) {
      expect(firstMessage(name, value), JSON.stringify(value)).toBe(SENTENCE);
    }
  });

  it.each(FREE_TEXT)("lets %s hold a tab, a line feed and a carriage return, and refuses any other control character", (name) => {
    expect(shape[name].safeParse("Hiking\tboard games\nand\r\nmaps").success).toBe(true);
    for (const value of ["a\u0000b", "a\u0007b", "a\u000Bb", "a\u000Cb", "a\u001Fb", "a\u007Fb"]) {
      expect(firstMessage(name, value), JSON.stringify(value)).toBe(SENTENCE);
    }
  });

  it("lets ordinary text through, accents and emoji included", () => {
    for (const name of [...ONE_LINE, ...FREE_TEXT]) {
      // Within each field's limit: the year takes four.
      const text = "Café ☕️ 10½".slice(0, fieldSpec(name)?.max ?? 50);
      expect(shape[name].safeParse(text).success, name).toBe(true);
    }
  });

  it("keeps the username's own rule, and the dates' own", () => {
    expect(firstMessage("username", "sa\u0000m")).toBe("Username can only contain letters, numbers, underscores, and hyphens");
    expect(firstMessage("birthday", "1991-11-30\u0000")).toBe("Please enter a valid date (YYYY-MM-DD)");
  });

  it("refuses the whole form when one field holds a control character", () => {
    const parsed = profileEditSchema.safeParse({ username: "sam", display_name: "Sam Rivera", bio: null, shirt_size: "M\u0000" });
    expect(parsed.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([[["shirt_size"], SENTENCE]]);
  });
});

describe("what a profile save carries", () => {
  // Who sees a field is not the profile form's: a saved field keeps its own setting, and a new one takes the stored
  // choice (updateProfile), so the form's data never names one, given one or not.
  it("names no choice of who sees a field", () => {
    expect(Object.keys(profileEditSchema.parse({ username: "sam", shirt_size: "M" }))).toEqual(["username", "shirt_size"]);
    expect(profileEditSchema.parse({ username: "sam", visible_to_group_types: ["family"] })).toEqual({ username: "sam" });
  });
});
