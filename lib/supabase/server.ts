import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { auth } from "@clerk/nextjs/server";
import type { Database } from "@/types/database";

/**
 * Server-side Supabase client authenticated as the current Clerk user.
 * RLS applies.
 *
 * The accessToken callback defers to Clerk's `getToken()`. With no template
 * argument that returns the `sessionToken` captured from the incoming
 * request at `auth()` time -- the same string for the life of this request,
 * not a freshly minted one per query. That is correct: the request is short
 * and the token was valid when it arrived. Refresh is the browser's job.
 */
export async function createClient() {
  const { getToken } = await auth();

  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { accessToken: () => getToken() }
  );
}
