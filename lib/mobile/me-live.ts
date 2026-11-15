import { createClient } from "@/lib/supabase/server";
import { readOwnContact } from "@/lib/profile/own-contact";
import { meResponse, type MeResponse } from "./me";

/**
 * The caller's own row, read under RLS by its named columns, and their email
 * from own_contact(). Throws when the row is missing or a read fails:
 * ensureProfile is fail-soft, so a signed-in person can have no row, and the
 * app should see a generic 500 (the messages below are only for the log).
 */
export async function loadMe(userId: string): Promise<MeResponse> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw new Error(`Could not read the profile for ${userId}: ${error.message}`);
  if (!data) {
    throw new Error(
      `No profile row visible for ${userId}: either ensureProfile could not create it, or Supabase did not accept the Clerk token (so RLS hid it)`
    );
  }

  const own = await readOwnContact(supabase);
  if ("error" in own) {
    throw new Error(`Could not read the contact details for ${userId}: ${own.error.message}`);
  }
  return meResponse({ ...data, email: own.contact?.email ?? null });
}
