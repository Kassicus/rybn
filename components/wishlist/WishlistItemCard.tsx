"use client";

import { Circle, Lock } from "lucide-react";
import { Text } from "@/components/ui/text";
import Link from "next/link";
import { PRIORITY_INFO } from "@/lib/schemas/wishlist";
import type { GroupType } from "@/types/privacy";
import { GROUP_TYPES } from "@/types/privacy";
import { ClaimActions } from "./ClaimActions";
import { ItemOccasionTags } from "./ItemOccasionTags";
import type { UpcomingOccasion } from "@/lib/occasions/display";
import { cn } from "@/lib/utils";

interface WishlistItem {
  id: string;
  title: string;
  description?: string | null;
  url?: string | null;
  price?: number | null;
  /** Signed and renderable; expires. This is the one to put in an <img>. */
  image_url?: string | null;
  /** Raw stored value, masked to null when it is another user's object path.
   *  Never rendered -- it is what a WRITER needs (edit form, gift-tracker copy). */
  image_path?: string | null;
  priority: 'low' | 'medium' | 'high' | 'must-have';
  category?: string | null;
  privacy_settings: {
    visibleToGroupTypes: GroupType[];
    restrictToGroup?: string | null;
  };
  purchased?: boolean;
  out_of_stock_marked_by?: string | null;
}

interface WishlistItemCardProps {
  item: WishlistItem;
  isOwnWishlist?: boolean;
  currentUserId?: string;
  /**
   * The id of whoever holds the active claim on this item, from
   * getActiveClaims() -- never supplied on the owner's own list (RLS
   * returns no claims there, and this card must not assume that rather
   * than being handed it explicitly). Task 5 dropped
   * wishlist_items.claimed_by; this is its replacement, resolved by the
   * page/SortableWishlistItems rather than read off the item row.
   */
  claimedBy?: string | null;
  /**
   * Label for the occasion the active claim was made for (e.g. "Mom's
   * Birthday"), resolved by the caller via occasionLabel() against
   * getActiveClaims()'s occasionId -- getActiveClaims itself does not
   * bundle this. Null for an unscoped claim, or when there is no active
   * claim.
   */
  claimedOccasionLabel?: string | null;
  /**
   * The wishlist OWNER's id and the birthday/anniversary currently in view
   * (see viewedOccasionId/Label below for the display counterpart) -- the
   * occasion a NEW claim on this item would be scoped to. Forwarded
   * straight through to ClaimActions; occasionKind: null means claim
   * unscoped. Never supplied on the owner's own list, where claiming does
   * not apply.
   */
  celebrantId?: string | null;
  occasionKind?: "birthday" | "anniversary" | null;
  /** Occasion ids this item is tagged for. Empty array, never undefined, so
      the card never has to distinguish "no tags" from "tags not loaded".
      Only ever consumed by ItemOccasionTags on the OWNER's own list (chip
      labels and removal need the real ids) -- never supplied, and never
      read, on a viewer's list. See taggedForViewedOccasion below for what
      the viewer-side badge uses instead. */
  taggedOccasionIds?: string[];
  /** Only supplied on the owner's own list, where tagging is permitted. */
  availableOccasions?: UpcomingOccasion[];
  /** The occasion a VIEWER currently has in view (SortableWishlistItems'
      occasionId), for the "tagged for this occasion" badge below. Never
      supplied on the owner's own list -- see showOccasionBadge. */
  viewedOccasionId?: string | null;
  /** Display label for viewedOccasionId, e.g. "Jane's Birthday" -- the
      badge's text. Supplied together with viewedOccasionId; either both are
      present or neither is. */
  viewedOccasionLabel?: string | null;
  /**
   * Whether THIS item is tagged for viewedOccasionId -- a single boolean,
   * not the item's full tag list. SortableWishlistItems already computes
   * exactly this membership test once per item (occasionTaggedIds, the Set
   * partitionByOccasion groups by) to decide which section an item renders
   * in; this prop reuses that same computation rather than shipping every
   * item's complete occasion-id array to the browser just so the card can
   * check membership in one of them itself. Never supplied on the owner's
   * own list, alongside viewedOccasionId/Label above.
   */
  taggedForViewedOccasion?: boolean;
}


export function WishlistItemCard({
  item,
  isOwnWishlist = false,
  currentUserId,
  claimedBy = null,
  claimedOccasionLabel = null,
  celebrantId = null,
  occasionKind = null,
  taggedOccasionIds = [],
  availableOccasions,
  viewedOccasionId = null,
  viewedOccasionLabel = null,
  taggedForViewedOccasion = false,
}: WishlistItemCardProps) {
  const priorityInfo = PRIORITY_INFO[item.priority];

  const visibleToGroupTypes = item.privacy_settings?.visibleToGroupTypes || [];
  const restrictToGroup = item.privacy_settings?.restrictToGroup;
  const isPrivate = visibleToGroupTypes.length === 0 && !restrictToGroup;

  // Gray out purchased items for non-owners
  const isPurchasedForViewer = !isOwnWishlist && item.purchased;
  const showClaimActions = !isOwnWishlist && currentUserId;
  // A viewer must never see a tag control on somebody else's item -- the
  // RLS policy on wishlist_item_occasions would refuse the write anyway
  // (it gates on the ITEM's ownership), but offering a control that always
  // fails is worse than not offering it. Gated on isOwnWishlist, the prop
  // the page already passes for exactly this purpose -- not on
  // currentUserId === item.user_id, which this shared card cannot compute
  // reliably (item.user_id is not even part of the WishlistItem shape
  // above) and which isOwnWishlist already exists to answer.
  // currentUserId is required in addition to the two checks above because
  // ItemOccasionTags now needs it (Minor 8: it filters availableOccasions
  // itself via taggableOccasions() rather than trusting a caller to have
  // pre-filtered). On the owner's own list this is always the caller's own
  // id -- see the page, which passes currentUserId alongside
  // availableOccasions for exactly this.
  const showOccasionTags =
    isOwnWishlist && availableOccasions !== undefined && !!currentUserId;
  // A viewer-side badge, never an owner-side one: viewedOccasionId/Label are
  // only ever supplied by SortableWishlistItems, which is only ever used on
  // /wishlist/user/[userId] (a viewer's page). The isOwnWishlist guard is
  // belt-and-braces against this shared card being reused somewhere that
  // passes both isOwnWishlist and a viewedOccasionId by mistake -- the same
  // defensive posture showOccasionTags takes above, in the other direction.
  //
  // taggedForViewedOccasion IS the occasionTaggedIds.has(item.id) membership
  // test -- computed once by SortableWishlistItems (the same Set
  // partitionByOccasion groups by) and handed down as a plain boolean,
  // rather than this card re-deriving it from a full per-item tag array
  // that would otherwise have to ship to the browser just for this check.
  const showOccasionBadge =
    !isOwnWishlist &&
    !!viewedOccasionId &&
    !!viewedOccasionLabel &&
    taggedForViewedOccasion;

  return (
    <div
      className={`rounded-lg border border-light-border bg-light-background ${
        isPurchasedForViewer ? "opacity-50" : ""
      }`}
    >
      <Link href={`/wishlist/${item.id}`} className="block">
        <div className="p-4 hover:bg-light-background-hover transition-colors rounded-t-lg">
          <div className="flex gap-4">
            {/* Image */}
            {item.image_url && (
              <div className="w-24 h-24 flex-shrink-0 rounded-md overflow-hidden bg-light-background-hover">
                {/* eslint-disable-next-line @next/next/no-img-element --
                    signed Supabase URLs and arbitrary retailer URLs from
                    pasted links; next/image needs enumerable remotePatterns
                    and the retailer set is open-ended. */}
                <img
                  src={item.image_url}
                  alt={item.title}
                  className="w-full h-full object-cover"
                />
              </div>
            )}

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <Text className="font-display font-semibold text-lg truncate">
                      {item.title}
                    </Text>
                    {claimedBy && !isOwnWishlist && (
                      <span className="px-2 py-0.5 rounded-sm text-xs font-semibold bg-primary-50 text-primary">
                        {claimedOccasionLabel
                          ? `Claimed for ${claimedOccasionLabel}`
                          : "Claimed"}
                      </span>
                    )}
                    {item.purchased && !isOwnWishlist && (
                      <span className="px-2 py-0.5 rounded-sm text-xs font-semibold bg-gold-tint text-gold-ink">
                        Purchased
                      </span>
                    )}
                    {item.out_of_stock_marked_by && !isOwnWishlist && (
                      <span className="px-2 py-0.5 rounded-sm text-xs font-semibold bg-error-light text-error">
                        Out of Stock
                      </span>
                    )}
                    {/* Occasion badge: same bg-primary-50/text-primary tokens
                        already used for the "Claimed" pill above and for
                        priority's own "medium" tone (PRIORITY_INFO.medium.
                        toneClass), and for the tag chips ItemOccasionTags
                        renders on the owner's list -- so this reads as the
                        same "occasion" vocabulary Task 4 already
                        established, not a new color introduced here.
                        Renders nothing when the item is untagged: an
                        "untagged" badge would turn the absence of an
                        owner's statement into a visible label about them. */}
                    {showOccasionBadge && (
                      <span className="px-2 py-0.5 rounded-sm text-xs font-semibold bg-primary-50 text-primary">
                        {viewedOccasionLabel}
                      </span>
                    )}
                  </div>

                  {item.description && (
                    <Text
                      variant="secondary"
                      size="sm"
                      className="line-clamp-2 mb-2"
                    >
                      {item.description}
                    </Text>
                  )}

                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Priority */}
                    <div className="flex items-center gap-1.5">
                      <Circle
                        className={cn("w-4 h-4", priorityInfo.toneClass)}
                        fill="currentColor"
                      />
                      <Text size="sm" className={priorityInfo.toneClass}>
                        {priorityInfo.label}
                      </Text>
                    </div>

                    {/* Price */}
                    {item.price && (
                      <Text size="sm" className="font-medium">
                        ${item.price.toFixed(2)}
                      </Text>
                    )}

                    {/* Category */}
                    {item.category && (
                      <span className="px-2 py-0.5 rounded-sm text-xs font-medium bg-light-background-hover text-ink-soft">
                        {item.category}
                      </span>
                    )}

                    {/* Privacy indicator - only show on own wishlist */}
                    {isOwnWishlist && (
                      <div className="flex items-center gap-1">
                        <Lock className="w-3 h-3 text-ink-muted" />
                        <Text size="sm" variant="secondary">
                          {isPrivate
                            ? "Private"
                            : restrictToGroup
                            ? "Restricted to 1 group"
                            : `Visible to: ${visibleToGroupTypes
                                .map((t) => GROUP_TYPES[t].label)
                                .join(", ")}`}
                        </Text>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Link>

      {/* Claim actions - only show when viewing others' wishlists */}
      {showClaimActions && (
        <div className="px-4 pb-4 pt-2 border-t border-light-border">
          <ClaimActions
            itemId={item.id}
            claimedBy={claimedBy}
            purchased={item.purchased || false}
            outOfStockMarkedBy={item.out_of_stock_marked_by || null}
            currentUserId={currentUserId}
            // Inert fallback: ClaimActions only renders when
            // showClaimActions is true, which only ever happens on a
            // viewer's list -- the one caller (SortableWishlistItems) that
            // always supplies a real celebrantId/occasionKind alongside it.
            celebrantId={celebrantId ?? ""}
            kind={occasionKind}
            claimedOccasionLabel={claimedOccasionLabel}
            variant="card"
            itemData={{
              title: item.title,
              description: item.description,
              url: item.url,
              price: item.price,
              image_path: item.image_path,
              // image_url survives signing, image_path does not survive the
              // owner mask -- so this pair says "has an image we cannot hand on".
              image_is_private_upload: !!item.image_url && !item.image_path,
            }}
          />
        </div>
      )}

      {/* Occasion tags - only on the owner's own list; see showOccasionTags
          above for the gate this depends on. The `availableOccasions &&` /
          `currentUserId &&` repeat that gate so TypeScript can narrow both
          from optional to required within this block. */}
      {showOccasionTags && availableOccasions && currentUserId && (
        <div className="px-4 pb-4 pt-2 border-t border-light-border">
          <ItemOccasionTags
            itemId={item.id}
            userId={currentUserId}
            taggedOccasionIds={taggedOccasionIds}
            availableOccasions={availableOccasions}
          />
        </div>
      )}
    </div>
  );
}
