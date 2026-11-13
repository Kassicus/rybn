"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import {
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
 * Update user's privacy settings with one database call,
 * set_profile_visibility: it stores the choice (profile_visibility) and
 * writes it onto every profile_info field the person has, setting only each
 * field's privacy_settings, in the same call.
 *
 * The stored choice is what the Settings page shows. The two writes succeed
 * or fail together, so after a failure the page shows the choice from
 * before, which is what the fields still have, and choosing the new one
 * again is a change it saves.
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
  // Every field of the caller's, a field tied to one group included, takes
  // the choice, so none differs from it afterwards. The database finds the
  // caller from their own token, not from an argument.
  const { error } = await supabase.rpc("set_profile_visibility", { p_kinds: parsed.data });

  if (error) {
    console.error("Error updating privacy settings:", error);
    return { data: null, error: "Failed to update privacy settings" };
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  return { data: true, error: null };
}
