import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getUserWishlist } from "@/lib/actions/wishlist";
import { getActiveClaims } from "@/lib/actions/claims";
import { getSharedGroups } from "@/lib/actions/profile";
import { getUpcomingOccasions } from "@/lib/actions/occasions";
import { getTagsForItems } from "@/lib/actions/item-occasions";
import { isOccasionFor, occasionFor } from "@/lib/occasions/celebrant";
import { occasionLabel, daysUntil } from "@/lib/occasions/display";
import { itemsTaggedFor } from "@/lib/occasions/order";
import { RelativeWhen } from "@/components/occasions/RelativeWhen";
import { whenLabel } from "@/components/occasions/whenLabel";
import { formatMonthDay } from "@/lib/utils/dates";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { SortableWishlistItems } from "@/components/wishlist/SortableWishlistItems";
import { Gift, Eye, Users, Lock, Cake, Heart } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

import { getUserId } from "@/lib/auth/require-auth";

// Celebrant occasions only reach this page as "birthday" | "anniversary" --
// a group_date row always has celebrantId: null, so it can never match
// theirOccasion below. Same icon vocabulary UpcomingOccasions.tsx and
// DateReminderBanner.tsx already established, so no surface disagrees about
// what a birthday looks like.
const OCCASION_ICON = { birthday: Cake, anniversary: Heart } as const;
export default async function UserWishlistPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  const supabase = await createClient();

  const viewerId = await getUserId();

  if (!viewerId) {
    redirect("/login");
  }

  // Don't allow viewing your own wishlist through this route
  if (viewerId === userId) {
    redirect("/wishlist");
  }

  // Get the target user's profile
  const { data: targetUser } = await supabase
    .from("user_profiles")
    .select("id, username, display_name, avatar_url")
    .eq("id", userId)
    .single();

  if (!targetUser) {
    notFound();
  }

  // Get shared groups
  const { data: sharedGroups } = await getSharedGroups(userId);

  // Check if we have any shared groups
  if (!sharedGroups || sharedGroups.length === 0) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 p-6">
        <div className="flex items-center gap-4 mb-6">
          <Avatar className="w-16 h-16">
            {targetUser.avatar_url && <AvatarImage src={targetUser.avatar_url} />}
            <AvatarFallback>
              {(targetUser.display_name || targetUser.username || "?")
                .charAt(0)
                .toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div>
            <Heading level="h1">
              {targetUser.display_name || targetUser.username || "User"}&apos;s Wishlist
            </Heading>
            {targetUser.username && targetUser.display_name && (
              <Text variant="secondary">@{targetUser.username}</Text>
            )}
          </div>
        </div>

        <div className="p-6 rounded-lg border border-light-border bg-light-background-hover">
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-5 h-5" />
            <Text className="font-medium">No Shared Groups</Text>
          </div>
          <Text variant="secondary">
            You don&apos;t share any groups with this user, so you cannot view their wishlist.
          </Text>
        </div>
      </div>
    );
  }

  // getUpcomingOccasions() is scoped to the VIEWER (see its own doc comment),
  // and returns only what the viewer may see -- which for a celebrated
  // occasion means can_view_field() already found a qualifying shared group.
  // Finding this person among it is presentation only, not a second
  // authorization check: the "No Shared Groups" branch above already gated
  // the page, and a stranger's occasion could not appear in this list to
  // begin with.
  //
  // 60 days: wider than the viewer's-own-wishlist case (30), because this
  // reader is a GIVER, who needs more lead time than the celebrant needs for
  // themselves -- sourcing, shipping, or coordinating with the rest of a
  // group all take longer than "update your own list." Still well short of
  // the group page's/dashboard's full-year horizon, because this line is
  // context for THIS one occasion, not a calendar of everything coming up.
  const { data: occasions = [] } = await getUpcomingOccasions(60);
  // occasionFor(), not `celebrantId === userId`: a confirmed couple's
  // anniversary is stored under the canonical (user_a) partner, so an id
  // comparison gives a giver opening the NON-canonical partner's list no
  // anniversary header at all -- and, further down, a null occasion label on
  // claims already scoped to it.
  const theirOccasion = occasionFor(occasions, userId);
  // theirOccasion, when set, is always "birthday" | "anniversary" -- see the
  // OCCASION_ICON comment above.
  const theirOccasionKind = theirOccasion
    ? (theirOccasion.kind as "birthday" | "anniversary")
    : null;
  const TheirOccasionIcon = theirOccasionKind
    ? OCCASION_ICON[theirOccasionKind]
    : null;

  // Get the user's wishlist (RLS will filter based on privacy)
  const { data: items, error, currentUserId } = await getUserWishlist(userId);

  if (error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-error">Error loading wishlist: {error}</p>
      </div>
    );
  }

  const itemIds = (items ?? []).map((item) => item.id as string);

  // Every ACTIVE claim among this list's items, keyed by item id. Task 4
  // dropped wishlist_items.claimed_by/claimed_at; Task 5's getClaimerProfile(s)
  // went with them. getActiveClaims() is their replacement -- it returns
  // { claimedBy, occasionId } per item rather than a claimer id -> profile
  // map, and does NOT bundle the claimer's profile the way
  // getClaimerProfiles() used to (see itemClaims below for the deliberate
  // decision that follows from that).
  //
  // This is the one call on this page it would be a bug to make on the
  // OWNER's own list: RLS already returns nothing there, but calling it
  // anyway is the kind of call somebody later "fixes" by widening the
  // policy. This page only ever renders another user's wishlist (the
  // viewerId === userId redirect above sends an owner back to /wishlist
  // before this point), so that case cannot reach here.
  const claimsResult = await getActiveClaims(itemIds);
  const activeClaims = "data" in claimsResult ? claimsResult.data : {};

  // Every occasion belonging to THIS person that the viewer can see within
  // the 60-day window above, keyed by occasion id -- both birthday and
  // anniversary, not just theirOccasion (the sooner of the two, if both are
  // upcoming).
  //
  // "Belonging to" is isOccasionFor(), not `celebrantId === userId`. A claim
  // is scoped through get_or_create_celebrated_occasion(celebrantId: userId,
  // kind), which for a confirmed couple resolves to the CANONICAL (user_a)
  // partner's row -- so when this page shows the non-canonical partner's
  // list, the claim's occasion carries somebody else's celebrant_id and a
  // celebrant-only filter drops it, leaving every existing claim labelled
  // with a bare "Claimed" and no occasion.
  //
  // The occasion's date only ever gets closer over time (or the claim
  // self-heals as lapsed and getActiveClaims drops it), so an occasion
  // scoped while inside this 60-day window stays inside it for as long as
  // the claim stays active.
  const theirOccasionsById = new Map(
    occasions
      .filter(
        (occasion): occasion is typeof occasion & { occasionId: string } =>
          isOccasionFor(occasion, userId) && occasion.occasionId !== null
      )
      .map((occasion) => [occasion.occasionId, occasion] as const)
  );

  // Decision (see task-6-report.md): getActiveClaims does not bundle the
  // claimer's profile the way getClaimerProfiles() used to, and this app
  // shows "Claimed for Mom's Birthday" rather than "Jane is getting this" --
  // the claimer's identity is dropped rather than resolved through a second
  // profile lookup. What IS resolved here is the occasion label, from data
  // this page already has in hand (occasions, fetched above) rather than a
  // new round trip.
  const itemClaims: Record<
    string,
    { claimedBy: string; occasionLabel: string | null }
  > = {};
  for (const [itemId, claim] of Object.entries(activeClaims)) {
    const occasion = claim.occasionId
      ? theirOccasionsById.get(claim.occasionId)
      : undefined;
    itemClaims[itemId] = {
      claimedBy: claim.claimedBy,
      occasionLabel: occasion ? occasionLabel(occasion) : null,
    };
  }

  // Task 5: which items are tagged for the ONE occasion in view
  // (theirOccasion, found above) -- never "which items have any tag at
  // all." itemsTaggedFor() exists specifically so that distinction is a
  // named, tested function rather than an inline Object.keys() someone
  // reimplements incorrectly from memory (see its own doc comment).
  //
  // Read access to wishlist_item_occasions is gated by the ITEM's
  // visibility, not by tag ownership (getTagsForItems's own doc comment),
  // so this is safe to call for another person's items -- and nothing it
  // returns is claim-derived: that table has no claimed_by/purchased/
  // out_of_stock_marked_by columns to begin with.
  //
  // theirOccasion is null whenever this celebrant has no birthday or
  // anniversary within the 60-day window above; theirOccasion.occasionId is
  // null when it does but was never materialized. Either way
  // itemsTaggedFor(_, null) returns an empty Set, and
  // SortableWishlistItems's own hasOccasionGrouping falls through to
  // rendering the list exactly as it did before this feature existed --
  // not a case special-cased here.
  // tagsByItemId is an intermediate value ONLY -- it feeds itemsTaggedFor()
  // below and is not itself forwarded to SortableWishlistItems. Shipping
  // every item's full occasion-id array to the browser would be more than a
  // viewer's card needs: each card only ever asks "am I tagged for the ONE
  // occasion in view", which occasionTaggedIds (a Set of item ids) already
  // answers per item (Minor 9 of the final review). itemIds is computed
  // above, alongside getActiveClaims.
  const tagsResult = await getTagsForItems(itemIds);
  const tagsByItemId: Record<string, string[]> =
    "data" in tagsResult ? tagsResult.data : {};
  const occasionTaggedIds = itemsTaggedFor(
    tagsByItemId,
    theirOccasion?.occasionId ?? null
  );

  const displayName = targetUser.display_name || targetUser.username || "User";

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: `${displayName}'s Wishlist`, href: `/wishlist/user/${userId}` },
        ]}
      />
      {/* User Header */}
      <div className="flex items-center gap-4">
        <Avatar className="w-16 h-16">
          {targetUser.avatar_url && <AvatarImage src={targetUser.avatar_url} />}
          <AvatarFallback>
            {(targetUser.display_name || targetUser.username || "?")
              .charAt(0)
              .toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div>
          <Heading level="h1">
            {displayName}&apos;s Wishlist
          </Heading>
          {targetUser.username && targetUser.display_name && (
            <Text variant="secondary">@{targetUser.username}</Text>
          )}
          {theirOccasion && TheirOccasionIcon && (
            <div className="mt-1 flex items-center gap-1.5">
              <TheirOccasionIcon className="h-4 w-4 text-primary" />
              <Text variant="secondary" size="sm">
                {occasionLabel(theirOccasion)} is{" "}
                <RelativeWhen
                  occasionDate={theirOccasion.occasionDate}
                  serverLabel={whenLabel(daysUntil(theirOccasion.occasionDate))}
                />{" "}
                ({formatMonthDay(theirOccasion.occasionDate)})
              </Text>
            </div>
          )}
        </div>
      </div>

      {/* Visibility indicator */}
      <div className="p-3 rounded bg-primary-50 border border-primary-200">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4" />
          <Text size="sm">
            You are viewing this wishlist as a member of {sharedGroups.length} shared group(s)
          </Text>
        </div>
      </div>

      {/* Shared Groups */}
      {sharedGroups && sharedGroups.length > 0 && (
        <div className="p-4 rounded-lg border border-light-border">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4" />
            <Text className="font-medium">Shared Groups</Text>
          </div>
          <div className="flex flex-wrap gap-2">
            {sharedGroups.map((group: any) => (
              <span
                key={group.id}
                className="px-2 py-1 rounded text-xs bg-light-background-hover"
              >
                {group.name}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {items && items.length === 0 && (
        <div className="text-center py-16">
          <Gift className="w-16 h-16 mx-auto text-light-text-secondary mb-4" />
          <Heading level="h3" className="mb-2">No wishlist items</Heading>
          <Text variant="secondary">
            This user hasn&apos;t added any wishlist items you can see yet.
          </Text>
        </div>
      )}

      {/* Wishlist items */}
      {items && items.length > 0 && (
        <SortableWishlistItems
          items={items as any}
          currentUserId={currentUserId}
          claims={itemClaims}
          celebrantId={userId}
          occasionKind={theirOccasionKind}
          occasionTaggedIds={occasionTaggedIds}
          occasionLabel={theirOccasion ? occasionLabel(theirOccasion) : undefined}
          occasionId={theirOccasion?.occasionId ?? null}
        />
      )}
    </div>
  );
}
