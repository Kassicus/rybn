import { auth, currentUser } from "@clerk/nextjs/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fallbackUsername, sanitizeUsername } from "./username";

/**
 * Ensures a user_profiles row exists for the signed-in Clerk user, and
 * returns that user's Clerk id (null when signed out).
 *
 * FAIL-SOFT, and callers must know it: every failure path here logs and
 * returns the Clerk id anyway. A returned id therefore means "this is who is
 * signed in", NOT "the row is certainly there" -- throwing instead would turn
 * a transient Supabase blip into a 500 on every page, which is strictly worse
 * than one degraded render. Callers that cannot proceed without the row must
 * still handle its absence.
 *
 * Replaces the old on_auth_user_created trigger, which died with auth.users.
 * Runs lazily on the first authenticated request rather than via webhook,
 * which avoids the race where a user reaches the app before a webhook fires,
 * and self-heals if a row is ever missing.
 *
 * Uses the admin client because provisioning must not depend on the
 * Clerk -> Supabase token exchange being configured: if that ever breaks, a
 * user with no profile row has no way back. The service-role key bypasses RLS,
 * so this module is server-only and must never be imported from a client
 * component. (`lib/supabase/admin.ts` reads SUPABASE_SERVICE_ROLE_KEY.)
 *
 * `auth()` rather than `getUserId()` from ./require-auth: it is the same
 * primitive that helper wraps, imported directly because require-auth.ts
 * imports this file and a module cycle here would be gratuitous.
 */
export async function ensureProfile(): Promise<string | null> {
  const { userId } = await auth();
  if (!userId) return null;

  const admin = createAdminClient();

  // Existence check first, deliberately. This helper runs on EVERY
  // authenticated request, and `currentUser()` is a network round trip to
  // Clerk's Backend API while `auth()` only reads the request. In the steady
  // state -- profile already there, which is every request after the first --
  // this costs one indexed primary-key lookup and nothing else.
  const { data: existing, error: lookupError } = await admin
    .from("user_profiles")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (lookupError) {
    console.error("ensureProfile: profile lookup failed", lookupError);
    return userId;
  }

  if (existing) return userId;

  // Only now is Clerk worth calling: this is the one place that needs profile
  // fields (username, names, email, image) rather than just an id.
  const user = await currentUser();
  if (!user) return userId;

  const email = user.primaryEmailAddress?.emailAddress ?? null;
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") ||
    user.username ||
    null;

  const row = {
    id: userId,
    // Clerk permits usernames this column does not (up to 64 characters, a
    // wider alphabet). An unsanitised one raises 23514, which the retry below
    // does NOT catch, leaving the user permanently without a row.
    username: sanitizeUsername(user.username, userId),
    display_name: displayName,
    email,
    avatar_url: user.imageUrl ?? null,
  };

  // ignoreDuplicates:true is `on conflict (id) do nothing`, not `do update`.
  // Two reasons, both load-bearing:
  //
  //   1. username and display_name are edited IN THIS APP (see setUsername /
  //      updateProfile in lib/actions/profile.ts). Clerk does not know about
  //      those edits, so a `do update` running on every request would
  //      overwrite a chosen username with a generated one.
  //   2. `.select()` on a do-nothing insert returns ONLY the rows actually
  //      inserted -- an empty array when the row was already there. That is
  //      the signal the welcome email branches on, and it is decided by the
  //      database, so two concurrent first requests cannot both claim the
  //      insert.
  let { data: created, error } = await admin
    .from("user_profiles")
    .upsert(row, { onConflict: "id", ignoreDuplicates: true })
    .select("id");

  // 23505 here is the OTHER unique index: username. A Clerk username can
  // collide with one somebody already chose in this app, and the id-targeted
  // DO NOTHING does not cover that arbiter. Without this retry the user would
  // be left with no profile row at all, which breaks every page.
  if (error?.code === "23505") {
    ({ data: created, error } = await admin
      .from("user_profiles")
      .upsert(
        { ...row, username: fallbackUsername(userId) },
        { onConflict: "id", ignoreDuplicates: true }
      )
      .select("id"));
  }

  if (error) {
    console.error("ensureProfile: profile insert failed", error);
    return userId;
  }

  // Exactly the request that created the row, so exactly one welcome email.
  if (created && created.length > 0 && email) {
    try {
      // Imported here, not at module scope: lib/resend/client.ts THROWS on
      // load when RESEND_API_KEY is unset, and this module is now reachable
      // from the auth choke point that every server page imports.
      const { sendWelcomeEmail } = await import("@/lib/resend/send");
      const greeting =
        user.username || user.firstName || email.split("@")[0] || "there";
      await sendWelcomeEmail(email, greeting);
    } catch (emailError) {
      // The deleted app/auth/callback/route.ts wrapped this the same way: a
      // mail failure must never break the auth flow.
      console.error("ensureProfile: welcome email failed", emailError);
    }
  }

  return userId;
}
