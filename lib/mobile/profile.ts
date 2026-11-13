import {
  PROFILE_LIMITS,
  PROFILE_SECTIONS,
  fieldSpec,
  type ProfileCategory,
  type ProfileFieldName,
} from "@/lib/profile/fields";
import { PROFILE_SENTENCES, VISIBILITY_INVALID } from "@/lib/profile/sentences";
import { ALL_KINDS, isMixed, visibleToSchema } from "@/lib/profile/visibility";
import type { ProfileEditFormData } from "@/lib/schemas/profile";
import type { GroupType } from "@/types/privacy";
import type { ActionAnswers } from "./action-response";
import { mobilePerson, type MobilePerson, type PersonRow } from "./occasions";
import { RULES, mobileGroups } from "./wishlist";

/**
 * As GROUP_ROUTE_ANSWERS (lib/mobile/groups.ts), for the profile routes: the sentences of the action each calls that it
 * passes on as 422 with the website's words (actionAnswer), from lib/profile/sentences.ts. Any other answer is a fault.
 */
export const PROFILE_ROUTE_ANSWERS = {
  save: { refusals: [PROFILE_SENTENCES.usernameTaken] },
  visibility: { refusals: [VISIBILITY_INVALID] },
} as const satisfies Record<string, ActionAnswers>;

/** A catalog field as the profile form draws it, with what the person has saved in it (null when nothing). */
export interface ProfileFieldAnswer {
  name: ProfileFieldName;
  label: string;
  kind: "text" | "date";
  max: number;
  value: string | null;
}

export interface MyProfileAnswer {
  username: string | null;
  displayName: string | null;
  bio: string | null;
  avatarUrl: string | null;
  limits: { username: number; displayName: number; bio: number };
  sections: { id: ProfileCategory; title: string; fields: ProfileFieldAnswer[] }[];
  /** The person's stored choice of the kinds of group that see their fields, in the order family, friends, work, other. */
  visibleTo: GroupType[];
  /** Some field of theirs has a setting other than the stored choice. */
  mixed: boolean;
}

/** The profile_info columns these shapes read; privacy_settings only for the caller's own fields. */
export interface InfoRow {
  category: string;
  field_name: string;
  field_value: string | null;
  privacy_settings?: unknown;
}

const blank = (value: string | null | undefined): boolean => value == null || value.trim() === "";

/**
 * The value saved in each catalog field, by name, as the website's own profile form reads them (by name). A name the
 * catalog does not hold, and an empty value, are left out; the first saved value of a name is kept.
 */
function catalogValues(info: readonly InfoRow[]): Map<ProfileFieldName, string> {
  const values = new Map<ProfileFieldName, string>();
  for (const row of info) {
    const spec = fieldSpec(row.field_name);
    if (spec === null || blank(row.field_value) || values.has(spec.name)) continue;
    values.set(spec.name, row.field_value as string);
  }
  return values;
}

/**
 * The caller's own profile, as the app's profile form draws it: every catalog field in the catalog's order with what
 * they saved in it, the four named columns of their row, and their stored choice of who sees their fields. Nothing
 * else of the row is read.
 */
export function buildMyProfile(
  row: { username: string | null; display_name: string | null; bio: string | null; avatar_url: string | null },
  info: readonly InfoRow[],
  choice: readonly GroupType[],
): MyProfileAnswer {
  const values = catalogValues(info);
  return {
    username: row.username,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url,
    limits: { username: PROFILE_LIMITS.username, displayName: PROFILE_LIMITS.displayName, bio: PROFILE_LIMITS.bio },
    sections: PROFILE_SECTIONS.map((section) => ({
      id: section.id,
      title: section.title,
      fields: section.fields.map((field) => ({
        name: field.name,
        label: field.label,
        kind: field.kind,
        max: field.max,
        value: values.get(field.name) ?? null,
      })),
    })),
    visibleTo: ALL_KINDS.filter((kind) => choice.includes(kind)),
    mixed: isMixed(choice, info.map((r) => r.privacy_settings)),
  };
}

/** What `PUT /profile` takes: the three basic columns, always, and the fields the person changed. */
export interface ProfileBody {
  username: string;
  displayName: string | null;
  bio: string | null;
  fields: Partial<Record<ProfileFieldName, string | null>>;
}

const isRecord = (raw: unknown): raw is Record<string, unknown> =>
  typeof raw === "object" && raw !== null && !Array.isArray(raw);

const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";

/** Text trimmed, and empty text taken as none. */
const cleared = (value: string | null): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
};

const REFUSED = { ok: false, message: RULES.request } as const;

/**
 * A profile save's body, before the form's own rules (profileEditSchema) are checked: an object whose username is
 * text, whose displayName and bio are each text or null, and whose fields, if sent, are an object naming only catalog
 * fields, each text or null. Anything else is refused with the plain sentence. Every text is trimmed; an empty one is
 * a clear (null), except the username, which stays text for the form's rule to refuse. Nothing else in the body is
 * read, so an avatar or a choice of who sees the fields never reaches the save.
 */
export function parseProfileBody(raw: unknown): { ok: true; body: ProfileBody } | { ok: false; message: string } {
  if (!isRecord(raw)) return REFUSED;
  const { username, displayName, bio, fields } = raw;
  if (typeof username !== "string" || !isTextOrNull(displayName) || !isTextOrNull(bio)) return REFUSED;
  if (fields !== undefined && !isRecord(fields)) return REFUSED;

  const named: Partial<Record<ProfileFieldName, string | null>> = {};
  for (const [name, value] of Object.entries(fields ?? {})) {
    const spec = fieldSpec(name);
    if (spec === null || !isTextOrNull(value)) return REFUSED;
    named[spec.name] = cleared(value);
  }

  return {
    ok: true,
    body: { username: username.trim(), displayName: cleared(displayName), bio: cleared(bio), fields: named },
  };
}

/**
 * The profile form's data for a save: the three basic columns and the fields the body names. Never avatar_url, so the
 * save leaves the picture as it is, and never visible_to_group_types.
 */
export function profileFormData(body: ProfileBody): Record<string, unknown> {
  return { username: body.username, display_name: body.displayName, bio: body.bio, ...body.fields };
}

/**
 * The checked form data updateProfile is given: everything the form's schema passed except the visible_to_group_types
 * default it adds, so a save from the app never names who can see a field. The action checks its input with the same
 * schema, which gives that default back, and never reads it.
 */
export function updateProfileInput(checked: ProfileEditFormData): ProfileEditFormData {
  const { visible_to_group_types: _default, ...input } = checked;
  return input as ProfileEditFormData;
}

/**
 * A choice of who sees the profile: an object whose visibleTo is a list of the four kinds (none is only the person),
 * put in the order family, friends, work, other, once each. Anything else is refused with the Settings page's sentence.
 */
export function parseVisibilityBody(raw: unknown): { ok: true; visibleTo: GroupType[] } | { ok: false; message: string } {
  if (!isRecord(raw)) return { ok: false, message: VISIBILITY_INVALID };
  const parsed = visibleToSchema.safeParse(raw.visibleTo);
  return parsed.success ? { ok: true, visibleTo: parsed.data } : { ok: false, message: VISIBILITY_INVALID };
}

export interface PersonProfileAnswer {
  person: MobilePerson;
  bio: string | null;
  sections: {
    id: ProfileCategory;
    title: string;
    fields: { name: ProfileFieldName; label: string; kind: "text" | "date"; value: string }[];
  }[];
  sharedGroups: { id: string; name: string }[];
}

/**
 * Another person's profile, built field by field from what row-level security returned to the caller: the person as
 * everywhere else (never an email), their bio, the catalog fields returned that hold something, in the catalog's order
 * (a section with none is left out), and the groups the two share, by name. Nothing says what was not returned, and no
 * field's setting is read.
 */
export function buildPersonProfile(
  row: PersonRow & { bio: string | null },
  info: readonly InfoRow[],
  groups: readonly { id: string; name: string }[],
): PersonProfileAnswer {
  const values = catalogValues(info);
  const sections = PROFILE_SECTIONS.flatMap((section) => {
    const fields = section.fields.flatMap((field) => {
      const value = values.get(field.name);
      return value === undefined ? [] : [{ name: field.name, label: field.label, kind: field.kind, value }];
    });
    return fields.length === 0 ? [] : [{ id: section.id, title: section.title, fields }];
  });
  return {
    person: mobilePerson(row),
    bio: blank(row.bio) ? null : row.bio,
    sections,
    // As GET /groups lists them: by name, leaving out one stored with no name.
    sharedGroups: mobileGroups(groups.map((g) => ({ id: g.id, name: g.name }))).map((g) => ({ id: g.id, name: g.name })),
  };
}
