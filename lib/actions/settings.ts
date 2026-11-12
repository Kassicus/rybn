"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
  newFieldPrivacy,
  readStoredChoice,
  visibleToSchema,
  VISIBILITY_INVALID,
} from "@/lib/profile/visibility";

import { getUserId } from "@/lib/auth/require-auth";

export interface EmailPreferences {
  email_group_invites: boolean;
  email_date_reminders: boolean;
  email_gift_updates: boolean;
  email_exchange_notifications: boolean;
  email_marketing: boolean;
}

export interface PrivacySettings {
  visible_to_group_types: string[];
}

export interface UserSettings {
  email_preferences: EmailPreferences;
  privacy_settings: PrivacySettings;
}

/**
 * The email_preferences a user_profiles row holds. The column is not in the
 * hand-kept Row type (types/database.ts), so it is read off the row here.
 */
function storedEmailPreferences(profile: unknown): Partial<EmailPreferences> {
  if (typeof profile !== "object" || profile === null) return {};
  const stored = (profile as { email_preferences?: unknown }).email_preferences;
  return typeof stored === "object" && stored !== null && !Array.isArray(stored)
    ? (stored as Partial<EmailPreferences>)
    : {};
}

/**
 * Get user's email preferences and privacy settings. The privacy setting is
 * the person's stored choice (profile_visibility; all four kinds of group
 * until they choose).
 */
export async function getMySettings() {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { data: null, error: "Not authenticated" };
  }

  // Get profile from user_profiles table
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (profileError) {
    console.error("Error fetching profile:", profileError);
    return { data: null, error: "Failed to load settings" };
  }

  const stored = await readStoredChoice(supabase, userId);
  if ("error" in stored) {
    return { data: null, error: "Failed to load settings" };
  }

  // Default email preferences if not set
  const emailPreferences: EmailPreferences = {
    email_group_invites: true,
    email_date_reminders: true,
    email_gift_updates: true,
    email_exchange_notifications: true,
    email_marketing: false,
    ...storedEmailPreferences(profile),
  };

  const settings: UserSettings = {
    email_preferences: emailPreferences,
    privacy_settings: {
      visible_to_group_types: stored.choice,
    },
  };

  return { data: settings, error: null };
}

/**
 * Update user's email preferences
 */
export async function updateEmailPreferences(preferences: EmailPreferences) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { data: null, error: "Not authenticated" };
  }

  // Update email preferences in user_profiles table
  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({
      email_preferences: preferences,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId);

  if (updateError) {
    console.error("Error updating email preferences:", updateError);
    return { data: null, error: "Failed to update email preferences" };
  }

  revalidatePath("/settings");
  return { data: true, error: null };
}

/**
 * Update user's privacy settings: store the choice (profile_visibility), then
 * write it onto every profile_info field the person has, with one update that
 * names only privacy_settings (a field's value is never written here).
 */
export async function updatePrivacySettings(settings: PrivacySettings) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { data: null, error: "Not authenticated" };
  }

  // Any of the four kinds, once each, in the order family, friends, work, custom.
  const parsed = visibleToSchema.safeParse(settings?.visible_to_group_types);
  if (!parsed.success) {
    return { data: null, error: VISIBILITY_INVALID };
  }
  const kinds = parsed.data;

  const { error: choiceError } = await supabase
    .from("profile_visibility")
    .upsert({ user_id: userId, visible_to_group_types: kinds }, { onConflict: "user_id" });

  if (choiceError) {
    console.error("Error storing profile visibility:", choiceError);
    return { data: null, error: "Failed to update privacy settings" };
  }

  // Every field of the caller's, a field tied to one group included, takes
  // the choice, so none differs from it afterwards.
  const { error: updateError } = await supabase
    .from("profile_info")
    .update({ privacy_settings: newFieldPrivacy(kinds) })
    .eq("user_id", userId);

  if (updateError) {
    console.error("Error updating privacy settings:", updateError);
    return { data: null, error: "Failed to update privacy settings" };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  return { data: true, error: null };
}
