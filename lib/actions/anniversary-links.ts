"use server";

import { createClient } from "@/lib/supabase/server";
import { getUserId } from "@/lib/auth/require-auth";

/**
 * Server actions wrapping the four anniversary-link RPCs (Task 3,
 * 20260912000003_anniversary_link_rpcs.sql and its correction
 * 20260912000005_anniversary_link_rpc_corrections.sql), one reader of
 * `anniversary_links` itself, and one reader of `group_members` for the
 * Task 9 partner picker.
 *
 * Every function here uses the USER-SCOPED client (@/lib/supabase/server),
 * never the admin one: all four RPCs are SECURITY DEFINER and pin themselves
 * to requesting_user_id(), which the admin client never carries -- the same
 * contract lib/actions/claims.ts documents for its own RPCs. getUserId() is
 * checked first so a signed-out caller never even builds a client.
 *
 * request_anniversary_link and confirm_anniversary_link raise with errcode
 * 22023 and a message already written for an end user ("you cannot share an
 * anniversary with yourself", "that person is not in any of your groups",
 * "that is not a usable date", "you already share an anniversary with that
 * person", "no anniversary request for you to confirm", "one of you already
 * shares an anniversary with somebody else"). Those are passed straight
 * through, the same way claims.ts treats claim_wishlist_item's 22023s;
 * anything else is swapped for a generic message and logged.
 *
 * decline_anniversary_link and unlink_anniversary never raise for "nothing to
 * do" -- a non-participant, a missing row, or the wrong status all return
 * `false`, which is not an error and maps to `{ ok: false }`.
 */

/**
 * The caller's own anniversary link, resolved so no consumer has to know
 * about canonical (user_a/user_b) ordering -- that is an internal storage
 * detail of the anniversary_links table.
 */
export type AnniversaryLink = {
  id: string;
  partnerId: string;
  partnerUsername: string | null;
  partnerDisplayName: string | null;
  status: "pending" | "confirmed";
  agreedDate: string;
  /** True when the CURRENT user sent the request -- the UI shows "cancel"
   *  rather than "confirm/decline" in that case. */
  initiatedByMe: boolean;
};

export async function requestAnniversaryLink(
  partnerId: string,
  date: string
): Promise<{ data: { linkId: string } } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("request_anniversary_link", {
    p_partner_id: partnerId,
    p_date: date,
  });

  if (error) {
    if (error.code === "22023") {
      return { error: error.message };
    }
    console.error("requestAnniversaryLink: RPC failed", error);
    return { error: "Failed to send that request. Please try again." };
  }

  if (!data) {
    console.error("requestAnniversaryLink: RPC returned no link id");
    return { error: "Failed to send that request. Please try again." };
  }

  return { data: { linkId: data } };
}

export async function confirmAnniversaryLink(
  linkId: string
): Promise<{ ok: true } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { error } = await supabase.rpc("confirm_anniversary_link", {
    p_link_id: linkId,
  });

  if (error) {
    if (error.code === "22023") {
      return { error: error.message };
    }
    console.error("confirmAnniversaryLink: RPC failed", error);
    return { error: "Failed to confirm that request. Please try again." };
  }

  return { ok: true };
}

/**
 * Either participant may remove a PENDING link this way -- the recipient
 * declining, or the initiator cancelling their own request (Task 3's
 * correction). `false` means there was nothing of the caller's to decline: a
 * non-participant, a missing link, or a link that is not (or no longer)
 * pending. That is not an error.
 */
export async function declineAnniversaryLink(
  linkId: string
): Promise<{ ok: boolean } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("decline_anniversary_link", {
    p_link_id: linkId,
  });

  if (error) {
    console.error("declineAnniversaryLink: RPC failed", error);
    return { error: "Failed to decline that request. Please try again." };
  }

  return { ok: data === true };
}

/**
 * Either participant may remove a CONFIRMED link this way. `false` means
 * there was nothing to unlink: a non-participant, a missing link, or a link
 * that is not (or no longer) confirmed. That is not an error.
 */
export async function unlinkAnniversary(
  linkId: string
): Promise<{ ok: boolean } | { error: string }> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("unlink_anniversary", {
    p_link_id: linkId,
  });

  if (error) {
    console.error("unlinkAnniversary: RPC failed", error);
    return { error: "Failed to remove that link. Please try again." };
  }

  return { ok: data === true };
}

/**
 * Reads `anniversary_links` through the user-scoped client and relies on
 * Task 1's own-participants-only SELECT policy to return only rows the
 * caller is part of.
 *
 * A person can hold at most one CONFIRMED link (anniversary_link_members'
 * primary key), but pending links are deliberately unconstrained -- a
 * confirmed link with one partner and a pending request with a different
 * person can coexist (Task 3's review established this). When more than one
 * row comes back, the confirmed relationship wins ("confirmed" sorts before
 * "pending" as an ORDER BY on `status`), and the most recently touched row
 * wins any further tie -- so this never throws on multiple rows and never
 * returns an arbitrary, order-dependent one.
 *
 * `partnerId` resolves to whichever of `user_a`/`user_b` is NOT the caller,
 * so no consumer has to know about canonical ordering.
 */
export async function getMyAnniversaryLink(): Promise<
  { data: AnniversaryLink | null } | { error: string }
> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("anniversary_links")
    .select("id, user_a, user_b, status, initiated_by, agreed_date")
    .order("status", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) {
    console.error("getMyAnniversaryLink: select failed", error);
    return { error: "Failed to load your anniversary link. Please try again." };
  }

  const row = data?.[0];
  if (!row) {
    return { data: null };
  }

  const partnerId = row.user_a === userId ? row.user_b : row.user_a;

  const { data: partnerProfile, error: profileError } = await supabase
    .from("user_profiles")
    .select("username, display_name")
    .eq("id", partnerId)
    .maybeSingle();

  if (profileError) {
    console.error(
      "getMyAnniversaryLink: partner profile lookup failed",
      profileError
    );
    return { error: "Failed to load your anniversary link. Please try again." };
  }

  return {
    data: {
      id: row.id,
      partnerId,
      partnerUsername: partnerProfile?.username ?? null,
      partnerDisplayName: partnerProfile?.display_name ?? null,
      status: row.status as "pending" | "confirmed",
      agreedDate: row.agreed_date,
      initiatedByMe: row.initiated_by === userId,
    },
  };
}

/** A person the caller could plausibly ask to share an anniversary with. */
export type AnniversaryPartnerCandidate = {
  id: string;
  username: string;
  displayName: string | null;
};

/**
 * People the caller shares at least one group with -- the pool
 * `AnniversaryPartner`'s picker (Task 9) offers for "Ask to share".
 *
 * This is a USABILITY filter, not a security boundary: request_anniversary_
 * link enforces the same shared-group requirement itself ("that person is
 * not in any of your groups"), and it is reachable directly through
 * PostgREST regardless of what this list contains. Narrowing the picker just
 * keeps someone from choosing a person the RPC would refuse anyway.
 *
 * One query, not a group-ids-then-members round trip: group_members' own
 * SELECT policy ("Users can view members of their groups") already narrows
 * an unfiltered select to exactly the rows RLS lets the caller see -- every
 * membership row for every group the caller is in, plus the caller's own
 * row wherever it lives. `.neq()` below only drops that last one.
 */
export async function getAnniversaryPartnerCandidates(): Promise<
  { data: AnniversaryPartnerCandidate[] } | { error: string }
> {
  const userId = await getUserId();
  if (!userId) {
    return { error: "Not authenticated" };
  }

  const supabase = await createClient();

  const { data: memberRows, error: membersError } = await supabase
    .from("group_members")
    .select("user_id")
    .neq("user_id", userId);

  if (membersError) {
    console.error(
      "getAnniversaryPartnerCandidates: group_members lookup failed",
      membersError
    );
    return { error: "Failed to load your groupmates. Please try again." };
  }

  const candidateIds = [
    ...new Set((memberRows ?? []).map((r) => r.user_id as string)),
  ];
  if (candidateIds.length === 0) {
    return { data: [] };
  }

  const { data: profiles, error: profilesError } = await supabase
    .from("user_profiles")
    .select("id, username, display_name")
    .in("id", candidateIds);

  if (profilesError) {
    console.error(
      "getAnniversaryPartnerCandidates: profile lookup failed",
      profilesError
    );
    return { error: "Failed to load your groupmates. Please try again." };
  }

  const candidates = (profiles ?? []).map((p) => ({
    id: p.id,
    username: p.username,
    displayName: p.display_name,
  }));

  candidates.sort((a, b) =>
    (a.displayName ?? a.username).localeCompare(b.displayName ?? b.username)
  );

  return { data: candidates };
}
