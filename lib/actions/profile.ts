/**
 * Profile server actions for Rybn
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { BasicProfileFormData, ProfileEditFormData } from "@/lib/schemas/profile";
import { planProfileFields, profileEditSchema } from "@/lib/schemas/profile";
import { newFieldPrivacy, readStoredChoice } from "@/lib/profile/visibility";
import type { Database, Json } from "@/types/database";
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

  // Get basic profile (RLS handles privacy): the columns the profile page and
  // its ProfileHeader show.
  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .select("username, display_name, avatar_url, bio")
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
 * Update full profile including all categorized fields.
 *
 * The input is checked with the form's own schema. Each catalog field the
 * input names is set (a non-empty string) or removed (null or empty); a field
 * it does not name is left as it is. A field that already has a row keeps the
 * setting on that row; a field saved for the first time takes the person's
 * stored choice (all four kinds of group until they choose).
 */
export async function updateProfile(formData: ProfileEditFormData) {
  const supabase = await createClient();

  const userId = await getUserId();

  if (!userId) {
    return { error: "Not authenticated" };
  }

  // A refused parse always carries at least one issue; the first is the
  // sentence the form would show.
  const parsed = profileEditSchema.safeParse(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  const input = parsed.data;

  // Provision before writing: this updates the caller's own row, and layout
  // provisioning races with page render (see getMyProfile above).
  await ensureProfile();

  // Update basic profile first. The avatar is written only when the input
  // carries one, so a save that does not send it leaves it as it is.
  const basics: Database["public"]["Tables"]["user_profiles"]["Update"] = {
    username: input.username,
    display_name: input.display_name,
    bio: input.bio,
    updated_at: new Date().toISOString(),
  };
  if (input.avatar_url !== undefined) {
    basics.avatar_url = input.avatar_url || null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("user_profiles")
    .update(basics)
    .eq("id", userId)
    .select()
    .single();

  if (profileError) {
    if (profileError.code === '23505' && profileError.message.includes('username')) {
      return { error: "Username is already taken" };
    }
    return { error: profileError.message };
  }

  const { set, clear } = planProfileFields(input);

  if (set.length > 0) {
    // The setting each of these fields already has, from the caller's own rows.
    const { data: rows, error: readError } = await supabase
      .from("profile_info")
      .select("field_name, privacy_settings")
      .eq("user_id", userId)
      .in("field_name", set.map((field) => field.field_name));

    if (readError) {
      return { error: readError.message };
    }

    const kept = new Map<string, Json>(
      (rows ?? []).map((row) => [row.field_name, row.privacy_settings])
    );

    let firstSave: Json | undefined;
    if (set.some((field) => !kept.has(field.field_name))) {
      const stored = await readStoredChoice(supabase, userId);
      if ("error" in stored) {
        return { error: stored.error };
      }
      firstSave = newFieldPrivacy(stored.choice);
    }

    const records: Database["public"]["Tables"]["profile_info"]["Insert"][] = set.map(
      (field) => ({
        user_id: userId,
        category: field.category,
        field_name: field.field_name,
        field_value: field.field_value,
        privacy_settings: kept.has(field.field_name) ? kept.get(field.field_name) : firstSave,
      })
    );

    const { error: saveError } = await supabase
      .from("profile_info")
      .upsert(records, {
        onConflict: "user_id,category,field_name",
        ignoreDuplicates: false,
      });

    if (saveError) {
      return { error: saveError.message };
    }
  }

  if (clear.length > 0) {
    const { error: clearError } = await supabase
      .from("profile_info")
      .delete()
      .eq("user_id", userId)
      .in("field_name", clear.map((field) => field.field_name));

    if (clearError) {
      return { error: clearError.message };
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

