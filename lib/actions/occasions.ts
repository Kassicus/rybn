"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth/require-auth";
import { groupDateSchema } from "@/lib/schemas/occasions";
import type { UpcomingOccasion } from "@/lib/occasions/display";

/**
 * Every occasion the signed-in user may see, soonest first.
 *
 * Must run on the USER-SCOPED client. get_upcoming_occasions() takes no viewer
 * parameter and pins itself to requesting_user_id(); the admin client carries
 * no Clerk subject, so the call would return an empty set rather than
 * everything. That is the same contract acceptInvitation() documents.
 *
 * One shared reader for the dashboard, group pages and wishlists, so the
 * "next event" cannot disagree between two screens.
 */
export async function getUpcomingOccasions(
  daysAhead: number = 30
): Promise<
  | { data: UpcomingOccasion[]; error?: never }
  | { error: string; data?: never }
> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_upcoming_occasions", {
    p_days_ahead: daysAhead,
  });

  if (error) {
    console.error("getUpcomingOccasions: RPC failed", error);
    return { error: "Failed to load upcoming occasions." };
  }

  const rows = (data ?? []) as Array<{
    occasion_id: string | null;
    kind: UpcomingOccasion["kind"];
    name: string | null;
    occasion_date: string;
    celebrant_id: string | null;
    celebrant_username: string | null;
    celebrant_display_name: string | null;
    group_id: string | null;
    group_name: string | null;
  }>;

  return {
    data: rows.map((r) => ({
      occasionId: r.occasion_id,
      kind: r.kind,
      name: r.name,
      occasionDate: r.occasion_date,
      celebrantId: r.celebrant_id,
      celebrantUsername: r.celebrant_username,
      celebrantDisplayName: r.celebrant_display_name,
      groupId: r.group_id,
      groupName: r.group_name,
    })),
  };
}

// Each uses the user-scoped client so the Task 1 policies apply -- the insert
// policy requires `created_by = requesting_user_id()`, so `created_by` is set
// explicitly rather than defaulted.
export async function createGroupDate(input: {
  groupId: string;
  name: string;
  occasionDate: string;
}): Promise<{ data: { id: string }; error?: never } | { error: string; data?: never }> {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated" };

  const parsed = groupDateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid occasion" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("occasions")
    .insert({
      group_id: parsed.data.groupId,
      kind: "group_date" as const,
      name: parsed.data.name,
      occasion_date: parsed.data.occasionDate,
      // Required by the insert policy, which checks it equals
      // requesting_user_id(). Not defaulted in the schema on purpose: a
      // default would be a claim the policy could not verify.
      created_by: userId,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // 42501 is RLS refusing the insert -- the caller is not a member of that
    // group. Reported as a membership problem, not a generic failure.
    if (error.code === "42501") {
      return { error: "You are not a member of this group" };
    }
    console.error("createGroupDate: insert failed", error);
    return { error: "Failed to create the occasion. Please try again." };
  }

  if (!data) {
    console.error("createGroupDate: no row returned after insert");
    return { error: "Failed to create the occasion. Please try again." };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/groups/${parsed.data.groupId}`);

  return { data: { id: data.id } };
}

/**
 * A zero-row result means the occasion does not exist OR the caller may not
 * touch it, and both return the SAME message on purpose. Telling them apart
 * would make this action an oracle for which occasion ids exist -- the same
 * reasoning acceptInvitation() documents for invitation tokens.
 */
export async function updateGroupDate(
  id: string,
  input: { name: string; occasionDate: string }
): Promise<{ data: { id: string }; error?: never } | { error: string; data?: never }> {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated" };

  // groupId is not being changed, so it is not part of this input. Reuse the
  // schema's field rules by parsing the two fields that are.
  const parsed = groupDateSchema
    .pick({ name: true, occasionDate: true })
    .safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid occasion" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("occasions")
    .update({
      name: parsed.data.name,
      occasion_date: parsed.data.occasionDate,
    })
    .eq("id", id)
    .eq("kind", "group_date")
    .select("id, group_id")
    .maybeSingle();

  if (error) {
    console.error("updateGroupDate: update failed", error);
    return { error: "Failed to update the occasion. Please try again." };
  }

  if (!data) {
    return { error: "That occasion no longer exists, or is not yours to edit" };
  }

  revalidatePath("/dashboard");
  if (data.group_id) revalidatePath(`/groups/${data.group_id}`);

  return { data: { id: data.id } };
}

export async function deleteGroupDate(
  id: string
): Promise<{ ok: true; error?: never } | { error: string; ok?: never }> {
  const userId = await getUserId();
  if (!userId) return { error: "Not authenticated" };

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("occasions")
    .delete()
    .eq("id", id)
    .eq("kind", "group_date")
    .select("id, group_id")
    .maybeSingle();

  if (error) {
    console.error("deleteGroupDate: delete failed", error);
    return { error: "Failed to delete the occasion. Please try again." };
  }

  if (!data) {
    return { error: "That occasion no longer exists, or is not yours to delete" };
  }

  revalidatePath("/dashboard");
  if (data.group_id) revalidatePath(`/groups/${data.group_id}`);

  return { ok: true };
}

// The .eq("kind", "group_date") on both update and delete above is
// belt-and-braces: the Task 1 policies already restrict these to group dates,
// but a celebrated occasion must never be reachable through a writer meant
// for group dates.
