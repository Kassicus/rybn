"use client";

import { Circle, Lock } from "lucide-react";
import { Text } from "@/components/ui/text";
import Link from "next/link";
import { PRIORITY_INFO } from "@/lib/schemas/wishlist";
import type { GroupType } from "@/types/privacy";
import { GROUP_TYPES } from "@/types/privacy";
import { ClaimActions } from "./ClaimActions";

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
  image_url?: string | null;
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
      className={`rounded-lg border border-light-border bg-white ${
        isPurchasedForViewer ? "opacity-50" : ""
      }`}
    >
      <Link href={`/wishlist/${item.id}`} className="block">
        <div className="p-4 hover:bg-gray-50 transition-colors rounded-t-lg">
          <div className="flex gap-4">
            {/* Image */}
            {item.image_url && (
              <div className="w-24 h-24 flex-shrink-0 rounded-md overflow-hidden bg-gray-100">
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
                    <Text className="font-semibold text-lg truncate">
                      {item.title}
                    </Text>
                    {item.claimed_by && !isOwnWishlist && (
                      <span className="px-2 py-0.5 rounded text-xs bg-green-100 text-green-700">
                        Claimed
                      </span>
                    )}
                    {item.purchased && !isOwnWishlist && (
                      <span className="px-2 py-0.5 rounded text-xs bg-blue-100 text-blue-700">
                        Purchased
                      </span>
                    )}
                    {item.out_of_stock_marked_by && !isOwnWishlist && (
                      <span className="px-2 py-0.5 rounded text-xs bg-red-100 text-red-700">
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
                        className="w-4 h-4"
                        style={{ color: priorityInfo.hexColor }}
                        fill="currentColor"
                      />
                      <Text size="sm" style={{ color: priorityInfo.hexColor }}>
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
                      <span className="px-2 py-0.5 rounded text-xs bg-light-background-hover">
                        {item.category}
                      </span>
                    )}

                    {/* Privacy indicator - only show on own wishlist */}
                    {isOwnWishlist && (
                      <div className="flex items-center gap-1">
                        <Lock className="w-3 h-3 text-gray-500" />
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
              image_url: item.image_url,
            }}
          />
        </div>
      )}
    </div>
  );
}
