"use client";

import { useEffect, useMemo, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { useSession } from "@clerk/nextjs";
import type { Database } from "@/types/database";

/**
 * Browser Supabase client authenticated as the current Clerk user.
 *
 * Keyed on the session *id*, not the session object. Clerk rebuilds the
 * `Session` instance on essentially every non-GET request it makes --
 * `Client.fromJSON()` calls `new Session(s)` unconditionally, and
 * `Base.ts` runs `_updateClient` on window focus (throttled 5s) and on
 * token rotation (~43s) -- so keying on the object would hand out a new
 * Supabase client several times a minute. That would tear down and rebuild
 * the realtime WebSocket underneath `ChatWindow`, and `postgres_changes`
 * has no replay, so any message inserted during the gap would be lost until
 * a full page reload. The id is stable for the life of a session, so the
 * client is not.
 *
 * Tokens stay fresh anyway, because the callback reads the session through
 * a ref rather than closing over one instance:
 *   - REST: `fetchWithAuth` invokes `accessToken()` on every request.
 *   - Realtime: `RealtimeClient.sendHeartbeat()` calls `_setAuthSafely()`
 *     every 25s, which awaits `accessToken()` afresh and pushes the new
 *     `access_token` to each joined channel without leaving or rejoining.
 *
 * The ref is assigned in an effect, so the callback can lag by one commit.
 * That is inert: `SessionTokenCache` is a module-level singleton keyed by
 * session id, so an older `Session` instance for the same id mints an
 * identical token.
 *
 * Sign-out is safe (`session` becomes null, the key changes, a new anonymous
 * client is built) and so is `setActive()` (the id changes).
 */
export function useSupabase() {
  const { session } = useSession();
  const sessionRef = useRef(session);

  useEffect(() => {
    sessionRef.current = session;
  });

  return useMemo(
    () =>
      createClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { accessToken: async () => (await sessionRef.current?.getToken()) ?? null }
      ),
    [session?.id]
  );
}
