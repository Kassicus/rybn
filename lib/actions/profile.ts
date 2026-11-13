/**
 * Profile server actions for Rybn
 */

"use server";

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { BasicProfileFormData, ProfileEditFormData } from "@/lib/schemas/profile";
import { planProfileFields, profileEditSchema } from "@/lib/schemas/profile";
import { newFieldPrivacy, readStoredChoice } from "@/lib/profile/visibility";
import type { Database } from "@/types/database";
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

  // Get profile info fields (RLS handles privacy filtering): the columns the
  // profile page shows of each.
  const { data: profileInfo, error: profileInfoError } = await supabase
    .from("profile_info")
    .select("id, category, field_name, field_value")
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
 * stored choice (all four kinds of group until they choose). Everything is
 * read before anything is written.
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

  const { set, clear } = planProfileFields(input);

  // Both reads come before any write, so a failed read changes nothing.
  // Which of the fields being set already have a row of the caller's, in
  // that field's own section; the others are new. The stored choice is read
  // whenever anything is set: a new field takes it, and so does a saved one
  // whose row is gone by the time it is written.
  const saved = new Set<string>();
  let newFieldSetting: ReturnType<typeof newFieldPrivacy> | null = null;

  if (set.length > 0) {
    const { data: rows, error: readError } = await supabase
      .from("profile_info")
      .select("category, field_name")
      .eq("user_id", userId)
      .in("field_name", set.map((field) => field.field_name));

    if (readError) {
      return { error: readError.message };
    }

    for (const row of rows ?? []) {
      saved.add(`${row.category}/${row.field_name}`);
    }

    const stored = await readStoredChoice(supabase, userId);
    if ("error" in stored) {
      return { error: "Failed to update profile" };
    }
    newFieldSetting = newFieldPrivacy(stored.choice);
  }

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

  // A field that had a row is written with an update of its value alone,
  // matched on the person, its section and its name, so a save never changes
  // its setting. The updates run together, and each asks for its row back.
  const savedFields = set.filter((field) => saved.has(`${field.category}/${field.field_name}`));
  const updates = await Promise.all(
    savedFields.map((field) =>
      supabase
        .from("profile_info")
        .update({ field_value: field.field_value })
        .eq("user_id", userId)
        .eq("category", field.category)
        .eq("field_name", field.field_name)
        .select("id")
    )
  );

  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) {
    return { error: updateError.message };
  }

  // New fields carry the stored choice. So does a saved field whose update
  // matched nothing (removed elsewhere since the read): what the person typed
  // is kept, and the field comes back with their choice, not the column's
  // default.
  const vanished = savedFields.filter((_, index) => (updates[index].data ?? []).length === 0);
  const newFields = [
    ...set.filter((field) => !saved.has(`${field.category}/${field.field_name}`)),
    ...vanished,
  ];

  if (newFields.length > 0) {
    const records: Database["public"]["Tables"]["profile_info"]["Insert"][] = newFields.map(
      (field) => ({
        user_id: userId,
        category: field.category,
        field_name: field.field_name,
        field_value: field.field_value,
        privacy_settings: newFieldSetting ?? undefined,
      })
    );

    // An upsert, so a row created elsewhere since the read takes the
    // person's value and choice instead of failing the save.
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

