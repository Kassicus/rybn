// Tests only. The profiles Task A6's routes answer, and the profile and settings actions and the read they call,
// answering as Sam's own client would.
import { vi, type Mock } from "vitest";
import { fieldSpec, type ProfileFieldName } from "@/lib/profile/fields";
import { newFieldPrivacy } from "@/lib/profile/visibility";
import { planProfileFields, profileEditSchema } from "@/lib/schemas/profile";
import type { GroupType } from "@/types/privacy";
import type { PersonRow } from "./occasions";
import type { InfoRow } from "./profile";
import { fixture } from "./test-fixtures";
import { SAM, world } from "./test-shopping";

/** Sam's own user_profiles columns, the four GET /profile answers. */
export const SAM_ROW = {
  username: "sam",
  display_name: "Sam Rivera",
  bio: "Coffee, maps and long walks.",
  avatar_url: "https://img.clerk.com/abc",
};

/** Sam's stored choice: his family and friends groups see his fields. */
export const SAM_CHOICE: readonly GroupType[] = Object.freeze(["family", "friends"]);

/** A row of Sam's in its catalog section. */
function samField(name: ProfileFieldName, value: string): InfoRow {
  return {
    category: fieldSpec(name)!.category,
    field_name: name,
    field_value: value,
    privacy_settings: { visibleToGroupTypes: ["family", "friends"], restrictToGroup: null },
  };
}

/** Sam's profile_info rows, each with his choice on it. */
export function samInfo(): InfoRow[] {
  return [
    samField("shoe_size", "10"),
    samField("shirt_size", "M"),
    samField("favorite_colors", "Green, navy"),
    samField("hobbies", "Hiking, board games"),
    samField("coffee_order", "Flat white"),
    samField("birthday", "1991-11-30"),
  ];
}

/** Mom's columns as Sam's client reads them. */
export const MOM_ROW: PersonRow & { bio: string | null } = {
  ...world().people.mom,
  bio: "Gardening, mysteries and good olive oil.",
};

/**
 * The profile_info rows of Mom's that row-level security returns to Sam: four catalog fields, one field the catalog
 * does not hold, and one saved empty.
 */
export function momVisible(): InfoRow[] {
  return [
    { category: "sizes", field_name: "ring_size", field_value: "7" },
    { category: "preferences", field_name: "favorite_colors", field_value: "Sage green" },
    { category: "preferences", field_name: "dislikes", field_value: "Scented candles" },
    { category: "dates", field_name: "birthday", field_value: "1962-01-14" },
    { category: "personal", field_name: "favorite_movie", field_value: "Paddington 2" },
    { category: "sizes", field_name: "shoe_size", field_value: "" },
  ];
}

export type ProfileMocks = Record<
  "getMyProfile" | "getMySettings" | "updateProfile" | "updatePrivacySettings" | "getSharedGroups" | "personProfileRows",
  Mock
>;

const STAMP = "2026-11-12T10:00:00.000000+00:00";

/**
 * The profile and settings actions and personProfileRows, each answering as the website's does for Sam: his saved
 * profile, which updateProfile and updatePrivacySettings change and getMyProfile and getMySettings read back. The
 * actions answer whole rows (his email included), as the website's do.
 */
export function profileMocks(): ProfileMocks {
  const w = world();
  const saved: {
    row: { username: string; display_name: string | null; bio: string | null; avatar_url: string | null };
    info: InfoRow[];
    choice: GroupType[];
  } = { row: { ...SAM_ROW }, info: samInfo(), choice: [...SAM_CHOICE] };
  const wholeRow = () => ({
    id: SAM,
    ...saved.row,
    email: "sam@example.com",
    email_preferences: { email_group_invites: true, email_marketing: false },
    created_at: STAMP,
    updated_at: STAMP,
  });
  const groups = new Map(
    fixture("groups").groups.map((g: { id: string; name: string; type: string }) => [g.id, g] as const),
  );

  return {
    getMyProfile: vi.fn(async () => ({
      data: {
        ...wholeRow(),
        profile_info: saved.info.map((r, i) => ({
          id: `0a0b0c0d-0000-4000-8000-00000000000${i}`,
          user_id: SAM,
          ...r,
          created_at: STAMP,
          updated_at: STAMP,
        })),
      },
    })),
    getMySettings: vi.fn(async () => ({
      data: {
        email_preferences: {
          email_group_invites: true,
          email_date_reminders: true,
          email_gift_updates: true,
          email_exchange_notifications: true,
          email_marketing: false,
        },
        privacy_settings: { visible_to_group_types: [...saved.choice] },
      },
      error: null,
    })),
    // As the action: a field it names is set or removed, a saved field keeps its setting, a new one takes the choice.
    updateProfile: vi.fn(async (input: unknown) => {
      const data = profileEditSchema.parse(input);
      saved.row = {
        ...saved.row,
        username: data.username,
        display_name: data.display_name === undefined ? saved.row.display_name : data.display_name,
        bio: data.bio === undefined ? saved.row.bio : data.bio,
      };
      const { set, clear } = planProfileFields(data);
      for (const field of set) {
        const row = saved.info.find((r) => r.field_name === field.field_name);
        if (row) row.field_value = field.field_value;
        else saved.info.push({ ...field, privacy_settings: newFieldPrivacy(saved.choice) });
      }
      saved.info = saved.info.filter((r) => !clear.some((c) => c.field_name === r.field_name));
      return { data: wholeRow() };
    }),
    updatePrivacySettings: vi.fn(async (settings: { visible_to_group_types: GroupType[] }) => {
      saved.choice = [...settings.visible_to_group_types];
      for (const r of saved.info) r.privacy_settings = newFieldPrivacy(saved.choice);
      return { data: true, error: null };
    }),
    // The groups Sam shares with the person, as the action answers them.
    getSharedGroups: vi.fn(async (id: string) => ({
      data: [...w.members]
        .filter(([, people]) => people.some((p) => p.id === id))
        .map(([gid]) => ({ ...(groups.get(gid) as { id: string; name: string; type: string }), description: null })),
    })),
    // Mom's columns and visible fields; anyone else in the world with no fields; nobody for an id Sam cannot see.
    personProfileRows: vi.fn(async (id: string) => {
      if (id === MOM_ROW.id) return { row: { ...MOM_ROW }, info: momVisible() };
      const person = Object.values(w.people).find((p) => p.id === id);
      return person ? { row: { ...person, bio: null }, info: [] } : { row: null, info: [] };
    }),
  };
}
