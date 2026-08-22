import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import type { Database } from "@/types/database";

/**
 * Server-side Supabase client authenticated as the current Clerk user.
 * RLS applies. The accessToken callback is invoked per request, so a
 * refreshed Clerk token is always used.
 */
export async function createClient() {
  const { getToken } = await auth();

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: () => getToken() }
  );
}
