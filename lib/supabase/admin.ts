// This module reads SUPABASE_SERVICE_ROLE_KEY. Non-NEXT_PUBLIC_ env vars are
// never inlined into a client bundle, so an accidental import from a
// "use client" file would not leak the key -- it would produce a client that
// silently throws at call time, or worse, one whose absence of RLS is assumed
// rather than checked. `server-only` turns that mistake into a build error.
import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Admin client using service role key
 * Use this for server-side operations that need to bypass RLS
 * IMPORTANT: Only use in server actions with proper authorization checks!
 */
export function createAdminClient() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
  }

  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
