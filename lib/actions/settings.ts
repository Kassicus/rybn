"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

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
 * Get user's email preferences and privacy settings
 */
export async function getMySettings() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { data: null, error: "Not authenticated" };
  }

  // Get profile from user_profiles table
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error("Error fetching profile:", profileError);
    return { data: null, error: "Failed to load settings" };
  }

  // Get profile_info for privacy settings
  const { data: profileInfo, error: profileInfoError } = await supabase
    .from("profile_info")
    .select("*")
    .eq("user_id", user.id);

  if (profileInfoError) {
    console.error("Error fetching profile info:", profileInfoError);
  }

  // Extract privacy settings from profile_info
  let visibleToGroupTypes: string[] = [];
  if (profileInfo && Array.isArray(profileInfo) && profileInfo.length > 0) {
    const firstField = profileInfo[0] as any;
    if (firstField.privacy_settings?.visibleToGroupTypes) {
      visibleToGroupTypes = firstField.privacy_settings.visibleToGroupTypes;
    }
  }

  // Default email preferences if not set
  const emailPreferences: EmailPreferences = {
    email_group_invites: true,
    email_date_reminders: true,
    email_gift_updates: true,
    email_exchange_notifications: true,
    email_marketing: false,
    ...(profile && (profile as any).email_preferences ? ((profile as any).email_preferences as Partial<EmailPreferences>) : {}),
  };

  const settings: UserSettings = {
    email_preferences: emailPreferences,
    privacy_settings: {
      visible_to_group_types: visibleToGroupTypes,
    },
  };

  return { data: settings, error: null };
}

/**
 * Update user's email preferences
 */
export async function updateEmailPreferences(preferences: EmailPreferences) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { data: null, error: "Not authenticated" };
  }

  // Update email preferences in user_profiles table
  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({
      email_preferences: preferences,
      updated_at: new Date().toISOString(),
    })
    .eq("id", user.id);

  if (updateError) {
    console.error("Error updating email preferences:", updateError);
    return { data: null, error: "Failed to update email preferences" };
  }

  revalidatePath("/settings");
  return { data: true, error: null };
}

/**
 * Update user's privacy settings
 */
export async function updatePrivacySettings(settings: PrivacySettings) {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return { data: null, error: "Not authenticated" };
  }

  // Get current profile_info records
  const { data: profileInfo, error: fetchError } = await supabase
    .from("profile_info")
    .select("*")
    .eq("user_id", user.id);

  if (fetchError) {
    console.error("Error fetching profile info:", fetchError);
    return { data: null, error: "Failed to load profile" };
  }

  // Update privacy settings in all profile_info fields
  if (profileInfo && profileInfo.length > 0) {
    const updatedProfileInfo = profileInfo.map((field: any) => ({
      ...field,
      privacy_settings: {
        visibleToGroupTypes: settings.visible_to_group_types,
      },
    }));

    // Update each profile_info record
    const { error: updateError } = await supabase
      .from("profile_info")
      .upsert(updatedProfileInfo as any, {
        onConflict: "user_id,category,field_name",
        ignoreDuplicates: false,
      });

    if (updateError) {
      console.error("Error updating privacy settings:", updateError);
      return { data: null, error: "Failed to update privacy settings" };
    }
  }

  revalidatePath("/settings");
  revalidatePath("/profile");
  return { data: true, error: null };
}
