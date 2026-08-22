"use client";

import { useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSession } from "@clerk/nextjs";
import type { Database } from "@/types/database";

/**
 * Browser Supabase client authenticated as the current Clerk user.
 * Memoised on the session so a stable client instance is reused, which
 * matters for realtime subscriptions.
 *
 * Realtime is covered automatically: supabase-js constructs its realtime
 * client with this same accessToken callback.
 */
export function useSupabase() {
  const { session } = useSession();

  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { accessToken: async () => (await session?.getToken()) ?? null }
      ),
    [session]
  );
}
