/**
 * Authorization Helper Functions
 *
 * SECURITY NOTICE:
 * These functions provide application-level authorization checks as a safety net
 * for operations that use the admin client to bypass RLS (Row Level Security).
 *
 * IMPORTANT: Always call these functions BEFORE using the admin client to perform
 * database operations. They verify that the authenticated user has permission
 * to access the requested resources.
 *
 * Background:
 * Due to RLS recursion issues in the database, the application uses admin clients
 * (with service role key) to bypass RLS for certain operations. This is necessary
 * but dangerous, so these helper functions ensure proper authorization.
 */

import { createClient } from "@/lib/supabase/server";

/**
 * Verify that a user is a member of a group
 *
 * @param userId - The user's UUID
 * @param groupId - The group's UUID
 * @returns true if user is a member, false otherwise
 *
 * @example
 * const isMember = await verifyGroupMembership(user.id, groupId);
 * if (!isMember) {
 *   return { error: "You are not a member of this group" };
 * }
 * // Safe to use admin client for this group
 */
export async function verifyGroupMembership(
  userId: string,
  groupId: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("group_members")
    .select("id")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!membership;
}

/**
 * Verify that a user is a member of a group gift
 *
 * @param userId - The user's UUID
 * @param groupGiftId - The group gift's UUID
 * @returns true if user is a member, false otherwise
 *
 * @example
 * const isMember = await verifyGroupGiftMembership(user.id, giftId);
 * if (!isMember) {
 *   return { error: "You are not a member of this group gift" };
 * }
 * // Safe to use admin client for this group gift
 */
export async function verifyGroupGiftMembership(
  userId: string,
  groupGiftId: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data: membership } = await supabase
    .from("group_gift_members")
    .select("id")
    .eq("group_gift_id", groupGiftId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!membership;
}

/**
 * Verify that a user owns a group gift (created it)
 *
 * @param userId - The user's UUID
 * @param groupGiftId - The group gift's UUID
 * @returns true if user owns the resource, false otherwise
 *
 * @example
 * const isOwner = await verifyGroupGiftOwnership(user.id, giftId);
 * if (!isOwner) {
 *   return { error: "You do not own this group gift" };
 * }
 * // Safe to use admin client for this resource
 */
export async function verifyGroupGiftOwnership(
  userId: string,
  groupGiftId: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data: resource } = await supabase
    .from("group_gifts")
    .select("created_by")
    .eq("id", groupGiftId)
    .maybeSingle();

  return resource?.created_by === userId;
}

/**
 * Verify that a user is a member of a gift exchange
 *
 * @param userId - The user's UUID
 * @param exchangeId - The gift exchange's UUID
 * @returns true if user is a member, false otherwise
 *
 * @example
 * const isMember = await verifyGiftExchangeMembership(user.id, exchangeId);
 * if (!isMember) {
 *   return { error: "You are not a member of this gift exchange" };
 * }
 * // Safe to use admin client for this gift exchange
 */
export async function verifyGiftExchangeMembership(
  userId: string,
  exchangeId: string
): Promise<boolean> {
  const supabase = await createClient();

  const { data: participant } = await supabase
    .from("gift_exchange_participants")
    .select("id")
    .eq("gift_exchange_id", exchangeId)
    .eq("user_id", userId)
    .maybeSingle();

  return !!participant;
}

/**
 * Get authenticated user or throw error
 *
 * @returns The authenticated user object
 * @throws Error if user is not authenticated
 *
 * @example
 * const user = await requireAuth();
 * // user is guaranteed to be defined here
 */
export async function requireAuth() {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    throw new Error("Not authenticated");
  }

  return user;
}

/**
 * Verify that a user can view another user's profile based on privacy settings
 *
 * @param viewerUserId - The user trying to view the profile
 * @param profileUserId - The user whose profile is being viewed
 * @returns true if viewer can see the profile, false otherwise
 *
 * Note: This is a placeholder - actual implementation should check privacy settings
 */
export async function verifyProfileViewPermission(
  viewerUserId: string,
  profileUserId: string
): Promise<boolean> {
  // Users can always view their own profile
  if (viewerUserId === profileUserId) {
    return true;
  }

  // TODO: Implement actual privacy checks based on user's privacy settings
  // For now, allow viewing (but privacy is handled by RLS and profile queries)
  return true;
}
