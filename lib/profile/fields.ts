/**
 * The one list of profile fields: their sections, labels, kinds and limits,
 * in the website's order. The profile form's schema (lib/schemas/profile.ts)
 * reads its limits and labels from here, and the app draws its profile form
 * from what the website sends, so a field added here needs no new app build.
 *
 * Imports nothing from Next, Clerk or Supabase: the browser's form loads it.
 */

export type ProfileCategory = "sizes" | "preferences" | "vehicles" | "personal" | "dates";

export type ProfileFieldName =
  | "shoe_size" | "shirt_size" | "pants_size" | "dress_size" | "ring_size" | "hat_size"
  | "favorite_colors" | "favorite_brands" | "style_preferences" | "hobbies" | "interests" | "dislikes"
  | "vehicle_make" | "vehicle_model" | "vehicle_year" | "vehicle_accessories_needed"
  | "dietary_restrictions" | "allergies" | "coffee_order" | "favorite_restaurant" | "favorite_snacks"
  | "birthday" | "anniversary";

export interface ProfileFieldSpec {
  name: ProfileFieldName;
  label: string;
  kind: "text" | "date";
  max: number;
}

export interface ProfileSectionSpec {
  id: ProfileCategory;
  title: string;
  fields: readonly ProfileFieldSpec[];
}

const text = (name: ProfileFieldName, label: string, max: number): ProfileFieldSpec => ({
  name,
  label,
  kind: "text",
  max,
});

/** Stored as YYYY-MM-DD, so ten characters. */
const date = (name: ProfileFieldName, label: string): ProfileFieldSpec => ({
  name,
  label,
  kind: "date",
  max: 10,
});

export const PROFILE_SECTIONS: readonly ProfileSectionSpec[] = [
  {
    id: "sizes",
    title: "Sizes",
    fields: [
      text("shoe_size", "Shoe size", 20),
      text("shirt_size", "Shirt size", 20),
      text("pants_size", "Pants size", 20),
      text("dress_size", "Dress size", 20),
      text("ring_size", "Ring size", 20),
      text("hat_size", "Hat size", 20),
    ],
  },
  {
    id: "preferences",
    title: "Preferences",
    fields: [
      text("favorite_colors", "Favorite colors", 200),
      text("favorite_brands", "Favorite brands", 200),
      text("style_preferences", "Style preferences", 200),
      text("hobbies", "Hobbies", 300),
      text("interests", "Interests", 300),
      text("dislikes", "Dislikes", 300),
    ],
  },
  {
    id: "vehicles",
    title: "Vehicles",
    fields: [
      text("vehicle_make", "Make", 50),
      text("vehicle_model", "Model", 50),
      text("vehicle_year", "Year", 4),
      text("vehicle_accessories_needed", "Accessories needed", 200),
    ],
  },
  {
    id: "personal",
    title: "Personal information",
    fields: [
      text("dietary_restrictions", "Dietary restrictions", 200),
      text("allergies", "Allergies", 200),
      text("coffee_order", "Favorite coffee order", 100),
      text("favorite_restaurant", "Favorite restaurant", 100),
      text("favorite_snacks", "Favorite snacks", 200),
    ],
  },
  {
    id: "dates",
    title: "Important dates",
    fields: [date("birthday", "Birthday"), date("anniversary", "Anniversary")],
  },
];

/** Every field's name, in catalog order. */
export const PROFILE_FIELD_NAMES: readonly ProfileFieldName[] = PROFILE_SECTIONS.flatMap(
  (section) => section.fields.map((field) => field.name)
);

// A Map, not an object literal, so a name such as "constructor" finds nothing.
const SPECS = new Map<string, ProfileFieldSpec & { category: ProfileCategory }>(
  PROFILE_SECTIONS.flatMap((section) =>
    section.fields.map((field) => [field.name, { ...field, category: section.id }] as const)
  )
);

/** A field's spec and section, or null for a name the catalog does not hold. */
export function fieldSpec(name: string): (ProfileFieldSpec & { category: ProfileCategory }) | null {
  const spec = SPECS.get(name);
  return spec ? { ...spec } : null;
}

/** The limits on the basic fields, which are columns of user_profiles. */
export const PROFILE_LIMITS = { username: 30, displayName: 50, bio: 500 } as const;
