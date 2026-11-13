/**
 * The caller's own profile and who sees it, read and saved with the website's own actions, and another person's profile
 * as row-level security shows it to the caller. Every answer is built field by field: never a row, never an email.
 */
import { getMyProfile, getSharedGroups, updateProfile } from "@/lib/actions/profile";
import { getMySettings, updatePrivacySettings, type UserSettings } from "@/lib/actions/settings";
import { profileEditSchema } from "@/lib/schemas/profile";
import { actionAnswer, databaseFailure } from "./action-response";
import { PERSON_ID } from "./database";
import {
  PROFILE_ROUTE_ANSWERS,
  buildMyProfile,
  buildPersonProfile,
  parseProfileBody,
  parseVisibilityBody,
  profileFormData,
  type InfoRow,
  type MyProfileAnswer,
  type PersonProfileAnswer,
} from "./profile";
import { personProfileRows } from "./profile-reads";
import { mobileError } from "./route";
import { RULES } from "./wishlist";
import type { GroupType } from "@/types/privacy";

/** The parts of getMyProfile's answer that are read: four named columns of the row, and the person's fields. */
interface MyProfileData {
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  profile_info: InfoRow[];
}

export async function myProfileAnswer(): Promise<Response | { profile: MyProfileAnswer }> {
  const [mine, settings] = await Promise.all([getMyProfile(), getMySettings()]);
  const failedProfile = databaseFailure(mine, "getMyProfile");
  if (failedProfile) return failedProfile;
  const failedSettings = databaseFailure(settings, "getMySettings");
  if (failedSettings) return failedSettings;

  const data = (mine as { data: MyProfileData }).data;
  // The stored choice in the order family, friends, work, other, as getMySettings reads it.
  const choice = (settings as { data: UserSettings }).data.privacy_settings.visible_to_group_types as GroupType[];
  // The row's four named columns; its email and every other column stay here.
  const row = { username: data.username, display_name: data.display_name, bio: data.bio, avatar_url: data.avatar_url };
  return { profile: buildMyProfile(row, data.profile_info ?? [], choice) };
}

/**
 * Saves the basic columns and the fields the body names with updateProfile, after the website form's own rules
 * (profileEditSchema) pass at the door, so a refused save writes nothing. Answers the profile read again, never the
 * row the action returns.
 */
export async function saveProfileAnswer(raw: unknown): Promise<Response | { profile: MyProfileAnswer }> {
  const parsed = parseProfileBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  const checked = profileEditSchema.safeParse(profileFormData(parsed.body));
  if (!checked.success) return mobileError("invalid", checked.error.issues[0]?.message ?? RULES.request);

  // What parseProfileBody gave, as the form's schema passed it.
  const result = await updateProfile(checked.data);
  const failed = actionAnswer(result, "updateProfile", PROFILE_ROUTE_ANSWERS.save);
  if (failed) return failed;
  return myProfileAnswer();
}

/** Stores who sees the caller's fields and writes it onto every field they have, as the Settings page does. */
export async function saveVisibilityAnswer(raw: unknown): Promise<Response | { visibleTo: GroupType[] }> {
  const parsed = parseVisibilityBody(raw);
  if (!parsed.ok) return mobileError("invalid", parsed.message);
  // Only the checked kinds reach the action.
  const result = await updatePrivacySettings({ visible_to_group_types: parsed.visibleTo });
  const failed = actionAnswer(result, "updatePrivacySettings", PROFILE_ROUTE_ANSWERS.visibility);
  if (failed) return failed;
  return { visibleTo: parsed.visibleTo };
}

/**
 * Another person's profile, as far as the caller may see it. Someone the caller cannot see, and someone they share no
 * group with, are both told the person is not there, as for an id that cannot be a person. So is the caller asking for
 * their own id: their profile is `GET /profile`, and this answer is only ever what another person sees.
 */
export async function personProfileAnswer(userId: string, personId: string): Promise<Response | PersonProfileAnswer> {
  if (!PERSON_ID.test(personId) || personId === userId) return mobileError("not_found");
  const { row, info } = await personProfileRows(personId);
  if (row === null) return mobileError("not_found");

  const shared = await getSharedGroups(personId);
  const failed = databaseFailure(shared, "getSharedGroups");
  if (failed) return failed;
  const groups = (shared as { data: { id: string; name: string }[] | null }).data ?? [];
  if (groups.length === 0) return mobileError("not_found");

  return buildPersonProfile(row, info, groups.map((g) => ({ id: g.id, name: g.name })));
}
