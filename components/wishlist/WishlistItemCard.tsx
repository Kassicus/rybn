"use client";

import { Circle, Lock } from "lucide-react";
import { Text } from "@/components/ui/text";
import Link from "next/link";
import { PRIORITY_INFO } from "@/lib/schemas/wishlist";
import type { GroupType } from "@/types/privacy";
import { GROUP_TYPES } from "@/types/privacy";
import { ClaimActions } from "./ClaimActions";
import { cn } from "@/lib/utils";

interface ClaimerInfo {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

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
  claimed_by?: string | null;
  purchased?: boolean;
  out_of_stock_marked_by?: string | null;
}

interface WishlistItemCardProps {
  item: WishlistItem;
  isOwnWishlist?: boolean;
  currentUserId?: string;
  claimerInfo?: ClaimerInfo | null;
}


export function WishlistItemCard({
  item,
  isOwnWishlist = false,
  currentUserId,
  claimerInfo,
}: WishlistItemCardProps) {
  const priorityInfo = PRIORITY_INFO[item.priority];

  const visibleToGroupTypes = item.privacy_settings?.visibleToGroupTypes || [];
  const restrictToGroup = item.privacy_settings?.restrictToGroup;
  const isPrivate = visibleToGroupTypes.length === 0 && !restrictToGroup;

  // Gray out purchased items for non-owners
  const isPurchasedForViewer = !isOwnWishlist && item.purchased;
  const showClaimActions = !isOwnWishlist && currentUserId;

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
                    {item.claimed_by && !isOwnWishlist && (
                      <span className="px-2 py-0.5 rounded-sm text-xs font-semibold bg-primary-50 text-primary">
                        Claimed
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
            claimedBy={item.claimed_by || null}
            purchased={item.purchased || false}
            outOfStockMarkedBy={item.out_of_stock_marked_by || null}
            currentUserId={currentUserId}
            claimerInfo={claimerInfo}
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
    </div>
  );
}
