import { describe, it, expect } from "vitest";
import type { z } from "zod";
import { profileEditSchema } from "@/lib/schemas/profile";
import { PROFILE_FIELD_NAMES, PROFILE_LIMITS, PROFILE_SECTIONS, fieldSpec } from "./fields";

/**
 * The one list of profile fields. The website's form schema reads its limits
 * and labels from it, and the app draws its profile form from it, so these
 * pin the words and numbers both show.
 */

const CATALOG = [
  ["sizes", "Sizes", [
    ["shoe_size", "Shoe size", "text", 20],
    ["shirt_size", "Shirt size", "text", 20],
    ["pants_size", "Pants size", "text", 20],
    ["dress_size", "Dress size", "text", 20],
    ["ring_size", "Ring size", "text", 20],
    ["hat_size", "Hat size", "text", 20],
  ]],
  ["preferences", "Preferences", [
    ["favorite_colors", "Favorite colors", "text", 200],
    ["favorite_brands", "Favorite brands", "text", 200],
    ["style_preferences", "Style preferences", "text", 200],
    ["hobbies", "Hobbies", "text", 300],
    ["interests", "Interests", "text", 300],
    ["dislikes", "Dislikes", "text", 300],
  ]],
  ["vehicles", "Vehicles", [
    ["vehicle_make", "Make", "text", 50],
    ["vehicle_model", "Model", "text", 50],
    ["vehicle_year", "Year", "text", 4],
    ["vehicle_accessories_needed", "Accessories needed", "text", 200],
  ]],
  ["personal", "Personal information", [
    ["dietary_restrictions", "Dietary restrictions", "text", 200],
    ["allergies", "Allergies", "text", 200],
    ["coffee_order", "Favorite coffee order", "text", 100],
    ["favorite_restaurant", "Favorite restaurant", "text", 100],
    ["favorite_snacks", "Favorite snacks", "text", 200],
  ]],
  ["dates", "Important dates", [
    ["birthday", "Birthday", "date", 10],
    ["anniversary", "Anniversary", "date", 10],
  ]],
] as const;

describe("the profile field catalog", () => {
  it("lists the 23 fields in five sections, in the website's order", () => {
    expect(PROFILE_FIELD_NAMES).toEqual([
      "shoe_size", "shirt_size", "pants_size", "dress_size", "ring_size", "hat_size",
      "favorite_colors", "favorite_brands", "style_preferences", "hobbies", "interests", "dislikes",
      "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_accessories_needed",
      "dietary_restrictions", "allergies", "coffee_order", "favorite_restaurant", "favorite_snacks",
      "birthday", "anniversary",
    ]);
    expect(
      PROFILE_SECTIONS.map((section) => [
        section.id,
        section.title,
        section.fields.map((field) => [field.name, field.label, field.kind, field.max]),
      ])
    ).toEqual(CATALOG);
  });

  it("matches the profile form's schema, limit for limit", () => {
    for (const section of PROFILE_SECTIONS) {
      for (const field of section.fields) {
        const schema: z.ZodType = profileEditSchema.shape[field.name];
        if (field.kind === "text") {
          expect(schema.safeParse("x".repeat(field.max)).success, field.name).toBe(true);
          const refused = schema.safeParse("x".repeat(field.max + 1));
          expect(refused.success, field.name).toBe(false);
          expect(refused.error?.issues[0]?.message, field.name).toBe(
            `${field.label} must be at most ${field.max} characters`
          );
        } else {
          expect(schema.safeParse("2024-02-29").success, field.name).toBe(true);
          expect(schema.safeParse("2026-02-29").success, field.name).toBe(false);
        }
      }
    }
  });

  it("gives the basic fields' limits", () => {
    expect(PROFILE_LIMITS).toEqual({ username: 30, displayName: 50, bio: 500 });
    const { username, display_name, bio } = profileEditSchema.shape;

    expect(username.safeParse("a".repeat(PROFILE_LIMITS.username)).success).toBe(true);
    expect(username.safeParse("a".repeat(PROFILE_LIMITS.username + 1)).success).toBe(false);
    expect(display_name.safeParse("a".repeat(PROFILE_LIMITS.displayName)).success).toBe(true);
    expect(display_name.safeParse("a".repeat(PROFILE_LIMITS.displayName + 1)).success).toBe(false);
    expect(bio.safeParse("a".repeat(PROFILE_LIMITS.bio)).success).toBe(true);
    expect(bio.safeParse("a".repeat(PROFILE_LIMITS.bio + 1)).success).toBe(false);
  });

  it("finds a field's spec, and nothing for a name it does not know", () => {
    expect(fieldSpec("ring_size")).toEqual({
      name: "ring_size",
      label: "Ring size",
      kind: "text",
      max: 20,
      category: "sizes",
    });
    expect(fieldSpec("birthday")?.category).toBe("dates");
    expect(fieldSpec("email")).toBeNull();
    expect(fieldSpec("constructor")).toBeNull();
  });
});
