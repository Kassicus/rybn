/**
 * Profile server actions for Rybn
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { BasicProfileFormData, ProfileEditFormData } from "@/lib/schemas/profile";
import { formDataToProfileInfo } from "@/lib/schemas/profile";
import type { ViewerContext, GroupType } from "@/types/privacy";

import { getUserId } from "@/lib/auth/require-auth";
import { ensureProfile } from "@/lib/auth/ensure-profile";
/**
 * Get the current user's full profile (all fields visible)
 */
export async function getMyProfile() {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // The dashboard layout provisions too, but Next renders layouts and pages
  // CONCURRENTLY: on a new user's first request this body can run while the
  // layout's ensureProfile() is still inserting, and the read below would then
  // miss the row and surface "Error loading profile". Ensuring at the point of
  // need is what actually closes that race, on every path rather than only the
  // ones that happen to render under that layout. The existence check inside
  // makes the steady-state cost one indexed primary-key lookup.
  await ensureProfile();

  // Get basic profile
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (profileError) {
    return { error: profileError.message };
  }

  // Get all profile info fields
  const { data: profileInfo, error: profileInfoError } = await supabase
    .from("profile_info")
    .select("*")
    .eq("user_id", userId);

  if (profileInfoError) {
    return { error: profileInfoError.message };
  }

  return {
    data: {
      ...profile,
      profile_info: profileInfo || [],
    },
  };
}

/**
 * Get another user's profile with privacy filtering
 */
export async function getUserProfile(profileUserId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Get basic profile (RLS handles privacy)
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("id", profileUserId)
    .single();

  if (profileError) {
    return { error: profileError.message };
  }

  // Get profile info fields (RLS handles privacy filtering)
  const { data: profileInfo, error: profileInfoError } = await supabase
    .from("profile_info")
    .select("*")
    .eq("user_id", profileUserId);

  if (profileInfoError) {
    return { error: profileInfoError.message };
  }

  return {
    data: {
      ...profile,
      profile_info: profileInfo || [],
    },
  };
}

/**
 * Update basic profile information
 */
export async function updateBasicProfile(formData: BasicProfileFormData) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Provision before writing: this updates the caller's own row, and layout
  // provisioning races with page render (see getMyProfile above).
  await ensureProfile();

  // Update profile
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .update({
      username: formData.username,
      display_name: formData.display_name,
      bio: formData.bio,
      avatar_url: formData.avatar_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .single();

  if (profileError) {
    // Check for unique constraint violation
    if (profileError.code === '23505' && profileError.message.includes('username')) {
      return { error: "Username is already taken" };
    }
    return { error: profileError.message };
  }

  revalidatePath("/profile");
  return { data: profile };
}

/**
 * Update full profile including all categorized fields
 */
export async function updateProfile(formData: ProfileEditFormData) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Provision before writing: this updates the caller's own row, and layout
  // provisioning races with page render (see getMyProfile above).
  await ensureProfile();

  // Update basic profile first
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .update({
      username: formData.username,
      display_name: formData.display_name,
      bio: formData.bio,
      avatar_url: formData.avatar_url || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .single();

  if (profileError) {
    if (profileError.code === '23505' && profileError.message.includes('username')) {
      return { error: "Username is already taken" };
    }
    return { error: profileError.message };
  }

  // Convert form data to profile_info records
  const profileInfoRecords = formDataToProfileInfo(userId, formData);

  // Upsert all profile_info records
  if (profileInfoRecords.length > 0) {
    const { error: profileInfoError } = await supabase
      .from("profile_info")
      .upsert(profileInfoRecords as any, {
        onConflict: "user_id,category,field_name",
        ignoreDuplicates: false,
      });

    if (profileInfoError) {
      return { error: profileInfoError.message };
    }
  }

  revalidatePath("/profile");
  revalidatePath("/profile/edit");
  return { data: profile };
}

/**
 * Get viewer context for privacy checks
 * Returns shared groups between viewer and profile owner
 */
export async function getViewerContext(profileUserId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Call the get_shared_groups database function
  const { data: sharedGroups, error } = await supabase.rpc("get_shared_groups", {
    user_a: userId,
    user_b: profileUserId,
  });

  if (error) {
    return { error: error.message };
  }

  if (!sharedGroups || sharedGroups.length === 0) {
    const viewerContext: ViewerContext = {
      viewerId: userId,
      sharedGroupIds: [],
      sharedGroupTypes: new Map(),
    };
    return { data: viewerContext };
  }

  const groupTypes = new Map<string, GroupType>(
    sharedGroups.map((g: { group_id: string; group_type: GroupType }) => [
      g.group_id,
      g.group_type,
    ])
  );

  const viewerContext: ViewerContext = {
    viewerId: userId,
    sharedGroupIds: sharedGroups.map((g: { group_id: string }) => g.group_id),
    sharedGroupTypes: groupTypes,
  };

  return { data: viewerContext };
}

/**
 * Get shared groups between current user and another user
 */
export async function getSharedGroups(otherUserId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { data: sharedGroups, error } = await supabase.rpc("get_shared_groups", {
    user_a: userId,
    user_b: otherUserId,
  });

  if (error) {
    return { error: error.message };
  }

  // Get full group details
  if (!sharedGroups || sharedGroups.length === 0) {
    return { data: [] };
  }

  const groupIds = sharedGroups.map((g: { group_id: string }) => g.group_id);

  const { data: groups, error: groupsError } = await supabase
    .from("groups")
    .select("id, name, type, description")
    .in("id", groupIds);

  if (groupsError) {
    return { error: groupsError.message };
  }

  return { data: groups || [] };
}

/**
 * Delete a specific profile info field
 */
export async function deleteProfileField(fieldId: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  const { error } = await supabase
    .from("profile_info")
    .delete()
    .eq("id", fieldId)
    .eq("user_id", userId); // Extra safety check

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/profile");
  return { data: { success: true } };
}

/**
 * Get user profile by username
 */
export async function getProfileByUsername(username: string) {
  const supabase = await createClient();

  const { data: profile, error } = await supabase
    .from("user_profiles")
    .select("*")
    .eq("username", username)
    .single();

  if (error) {
    return { error: error.message };
  }

  return { data: profile };
}

/**
 * Check if username is available
 */
export async function isUsernameAvailable(username: string, excludeUserId?: string) {
  const supabase = await createClient();

  let query = supabase
    .from("user_profiles")
    .select("id")
    .eq("username", username);

  if (excludeUserId) {
    query = query.neq("id", excludeUserId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return { error: error.message };
  }

  return { data: { available: !data } };
}

/**
 * Set username for OAuth users (first-time setup)
 */
export async function setUsername(username: string) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // Provision before writing: this updates the caller's own row, and layout
  // provisioning races with page render (see getMyProfile above).
  await ensureProfile();

  // Validate username format
  const usernameRegex = /^[a-zA-Z0-9_-]+$/;
  if (!usernameRegex.test(username)) {
    return {
      error: "Username can only contain letters, numbers, underscores, and hyphens"
    };
  }

  if (username.length < 3) {
    return { error: "Username must be at least 3 characters" };
  }

  if (username.length > 20) {
    return { error: "Username must be at most 20 characters" };
  }

  // First, verify the profile exists
  const { data: existingProfile, error: checkError } = await supabase
    .from("user_profiles")
    .select("id, username")
    .eq("id", userId)
    .maybeSingle();

  if (checkError) {
    console.error("Error checking profile:", checkError);
    return { error: `Database error: ${checkError.message}` };
  }

  if (!existingProfile) {
    console.error("Profile not found for user:", userId);
    return { error: "Your profile hasn't been created yet. Please wait a moment and try again." };
  }

  // Check if username is available
  const availabilityCheck = await isUsernameAvailable(username, userId);
  if (availabilityCheck.error) {
    return { error: availabilityCheck.error };
  }

  if (!availabilityCheck.data?.available) {
    return { error: "Username is already taken" };
  }

  // Update username
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .update({
      username: username,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .select()
    .maybeSingle();

  if (profileError) {
    console.error("Error updating profile:", profileError);
    if (profileError.code === '23505' && profileError.message.includes('username')) {
      return { error: "Username is already taken" };
    }
    return { error: `Update failed: ${profileError.message}` };
  }

  if (!profile) {
    console.error("Update returned no rows for user:", userId);
    return { error: "Failed to update username. Please try again or contact support." };
  }

  revalidatePath("/set-username");
  revalidatePath("/dashboard");
  return { data: profile };
}
