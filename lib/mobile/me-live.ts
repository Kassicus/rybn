import { createClient } from "@/lib/supabase/server";
import { meResponse, type MeResponse } from "./me";

/**
 * The caller's own row, read under RLS. Throws when it is missing or the read
 * fails: ensureProfile is fail-soft, so a signed-in person can have no row,
 * and the app should see a generic 500 (the message below is only for the log).
 */
export async function loadMe(userId: string): Promise<MeResponse> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, email, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the profile for ${userId}: ${error.message}`);
  if (!data) throw new Error(`No profile row for ${userId}`);
  return meResponse(data);
}
