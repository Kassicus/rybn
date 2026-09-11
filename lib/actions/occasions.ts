"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth/require-auth";
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
