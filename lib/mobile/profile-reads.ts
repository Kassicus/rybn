/**
 * Another person's profile, read with the caller's own client: row-level security decides which of their fields come
 * back, and whether their row does. Each read names its columns, copies them by name, and throws on a database error.
 */
import { createClient } from "@/lib/supabase/server";
import { failure } from "./database";
import type { PersonRow } from "./occasions";
import type { InfoRow } from "./profile";

/**
 * The person's named columns and the fields of theirs the caller may see. No row (and no fields, which are then never
 * asked for) for a person the caller cannot see.
 */
export async function personProfileRows(
  personId: string,
): Promise<{ row: (PersonRow & { bio: string | null }) | null; info: InfoRow[] }> {
  const supabase = await createClient();
  const { data: person, error } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url, bio")
    .eq("id", personId)
    .maybeSingle();
  if (error) throw failure("personProfileRows", error);
  if (!person) return { row: null, info: [] };

  const { data: fields, error: fieldsError } = await supabase
    .from("profile_info")
    .select("category, field_name, field_value")
    .eq("user_id", personId);
  if (fieldsError) throw failure("personProfileRows", fieldsError);

  return {
    row: {
      id: person.id,
      username: person.username,
      display_name: person.display_name,
      avatar_url: person.avatar_url,
      bio: person.bio,
    },
    info: (fields ?? []).map((f) => ({ category: f.category, field_name: f.field_name, field_value: f.field_value })),
  };
}
