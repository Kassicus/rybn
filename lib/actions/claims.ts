"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth/require-auth";

/**
 * Claim / release / read layer for public.wishlist_claims
 * (20260911100001_wishlist_claims.sql), backed entirely by the SECURITY
 * DEFINER RPCs from 20260911100000_celebrated_occasion_for_claims.sql and
 * 20260911100002_claim_rpcs.sql. `wishlist_items.claimed_by`/`claimed_at`
 * are gone (20260911100003_drop_item_claim_columns.sql); this file is their
 * replacement.
 *
 * Every function here uses the USER-SCOPED client (@/lib/supabase/server),
 * never the admin client: all three RPCs pin themselves to
 * requesting_user_id() and raise `not authenticated` (28000) when that is
 * null, so the admin client -- which carries no Clerk subject -- would make
 * every one of them fail. Shaped on lib/actions/occasions.ts and
 * lib/actions/item-occasions.ts: getUserId() before createClient() so a
 * signed-out caller never even builds a client, a generic caller-facing
 * message with the provider detail logged server-side for anything
 * unexpected, and the empty-list short circuit in getActiveClaims running
 * before either.
 *
 * The one deliberate departure from that shared shape: get_or_create_
 * celebrated_occasion and claim_wishlist_item both raise with errcode 22023
 * and a message already written for an end user (see their own migrations --
 * "that item is not available to claim", "you cannot claim your own item",
 * "that item has already been purchased", "that occasion is not available",
 * "somebody has already claimed that item", "no visible % for that person").
 * Those are passed straight through instead of being replaced by a generic
 * string; only a non-22023 error is swapped for one and logged.
 */

export async function claimItem(
  itemId: string,
  celebrantId: string,
  kind: "birthday" | "anniversary" | null
): Promise<{ data: { claimId: string } } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  // kind === null means an UNSCOPED claim: skip materialization entirely
  // and hand claim_wishlist_item a null p_occasion_id directly. Only when a
  // kind is given do we need an occasion id to label the claim with, and
  // that occasion is the CELEBRANT's (get_or_create_celebrated_occasion),
  // not the caller's own get_or_create_occasion -- the caller is claiming a
  // gift for somebody else's birthday or anniversary, not tagging their own.
  let occasionId: string | null = null;

  if (kind !== null) {
    const { data, error } = await supabase.rpc(
      "get_or_create_celebrated_occasion",
      { p_celebrant_id: celebrantId, p_kind: kind }
    );

    if (error) {
      if (error.code === "22023") {
        return { error: error.message };
      }
      console.error(
        "claimItem: get_or_create_celebrated_occasion failed",
        error
      );
      return { error: "Failed to claim this item. Please try again." };
    }

    if (!data) {
      console.error(
        "claimItem: get_or_create_celebrated_occasion returned no occasion id"
      );
      return { error: "Failed to claim this item. Please try again." };
    }

    occasionId = data;
  }

  const { data: claimId, error: claimError } = await supabase.rpc(
    "claim_wishlist_item",
    { p_item_id: itemId, p_occasion_id: occasionId }
  );

  if (claimError) {
    if (claimError.code === "22023") {
      return { error: claimError.message };
    }
    console.error("claimItem: claim_wishlist_item failed", claimError);
    return { error: "Failed to claim this item. Please try again." };
  }

  if (!claimId) {
    console.error("claimItem: claim_wishlist_item returned no claim id");
    return { error: "Failed to claim this item. Please try again." };
  }

  return { data: { claimId } };
}

/**
 * Releasing the CALLER's own claim. release_wishlist_claim() returns false
 * (not an error) when there was nothing of the caller's left to release --
 * an unclaim that finds nothing is not exceptional, so { ok: false } is the
 * right shape, not { error }.
 */
export async function releaseClaim(
  itemId: string
): Promise<{ ok: boolean } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("release_wishlist_claim", {
    p_item_id: itemId,
  });

  if (error) {
    console.error("releaseClaim: release_wishlist_claim failed", error);
    return { error: "Failed to release this claim. Please try again." };
  }

  return { ok: data === true };
}

/**
 * Every ACTIVE claim among the given items, keyed by item id. An item with
 * no active claim is simply absent from the result, not present with a null
 * value -- same convention getTagsForItems() uses for tags.
 *
 * The empty-list short circuit runs BEFORE getUserId() or createClient() are
 * even called, matching getTagsForItems() (lib/actions/item-occasions.ts):
 * Task 6 calls this once per wishlist render, so an empty item list (a page
 * with nothing on it yet) must not cost a database round trip.
 *
 * Read access is gated by wishlist_claims' own SELECT policy -- visible to
 * anyone who can see the ITEM, except the item's own owner -- so this can
 * safely be called for another person's items and simply returns nothing
 * for the caller's own.
 */
export async function getActiveClaims(
  itemIds: string[]
): Promise<
  | { data: Record<string, { claimedBy: string; occasionId: string | null }> }
  | { error: string }
> {
  if (itemIds.length === 0) {
    return { data: {} };
  }

  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("wishlist_claims")
    .select("item_id, claimed_by, occasion_id")
    .in("item_id", itemIds)
    .is("released_at", null);

  if (error) {
    console.error("getActiveClaims: select failed", error);
    return { error: "Failed to load claims. Please try again." };
  }

  const result: Record<string, { claimedBy: string; occasionId: string | null }> =
    {};
  for (const row of data ?? []) {
    result[row.item_id] = {
      claimedBy: row.claimed_by,
      occasionId: row.occasion_id,
    };
  }

  return { data: result };
}
