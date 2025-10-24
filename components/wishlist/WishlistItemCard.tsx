"use client";

import { useState } from "react";
import { ExternalLink, Edit, Trash2, Star, Circle, CircleDot, CircleDashed, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { deleteWishlistItem } from "@/lib/actions/wishlist";
import { useRouter } from "next/navigation";
import { PRIORITY_INFO } from "@/lib/schemas/wishlist";
import type { GroupType } from "@/types/privacy";
import { GROUP_TYPES } from "@/types/privacy";

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
  };
  claimed_by?: string | null;
  purchased?: boolean;
}

interface WishlistItemCardProps {
  item: WishlistItem;
  isOwnWishlist?: boolean;
  canClaim?: boolean;
  onClaim?: (itemId: string) => void;
  onUnclaim?: (itemId: string) => void;
}

const priorityIcons = {
  'low': CircleDashed,
  'medium': Circle,
  'high': CircleDot,
  'must-have': Star,
};

export function WishlistItemCard({ item, isOwnWishlist = false, canClaim = false, onClaim, onUnclaim }: WishlistItemCardProps) {
  const router = useRouter();
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this item?")) return;

    setIsDeleting(true);
    const result = await deleteWishlistItem(item.id);

    if (result.error) {
      alert(result.error);
      setIsDeleting(false);
    } else {
      router.refresh();
    }
  };

  const priorityInfo = PRIORITY_INFO[item.priority];
  const PriorityIcon = priorityIcons[item.priority];

  const visibleGroups = item.privacy_settings?.visibleToGroupTypes || [];
  const isPrivate = visibleGroups.length === 0;

  return (
    <div className="p-4 rounded-lg border border-light-border dark:border-dark-border hover:border-primary-300 dark:hover:border-primary-700 transition-all bg-white dark:bg-dark-background">
      <div className="flex gap-4">
        {/* Image */}
        {item.image_url && (
          <div className="w-24 h-24 flex-shrink-0 rounded-md overflow-hidden bg-gray-100 dark:bg-gray-800">
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
                <Text className="font-semibold text-lg truncate">{item.title}</Text>
                {item.claimed_by && !isOwnWishlist && (
                  <span className="px-2 py-0.5 rounded text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                    Claimed
                  </span>
                )}
                {item.purchased && !isOwnWishlist && (
                  <span className="px-2 py-0.5 rounded text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                    Purchased
                  </span>
                )}
              </div>

              {item.description && (
                <Text variant="secondary" size="sm" className="line-clamp-2 mb-2">
                  {item.description}
                </Text>
              )}

              <div className="flex items-center gap-4 flex-wrap">
                {/* Priority */}
                <div className="flex items-center gap-1.5">
                  <PriorityIcon className={`w-4 h-4 ${priorityInfo.color}`} />
                  <Text size="sm" className={priorityInfo.color}>
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
                  <span className="px-2 py-0.5 rounded text-xs bg-light-background-hover dark:bg-dark-background-hover">
                    {item.category}
                  </span>
                )}

                {/* Privacy indicator */}
                <div className="flex items-center gap-1">
                  {isPrivate ? (
                    <>
                      <Lock className="w-3 h-3 text-gray-500" />
                      <Text size="xs" variant="secondary">Private</Text>
                    </>
                  ) : (
                    <>
                      <Text size="xs" variant="secondary">
                        Visible to: {visibleGroups.map(t => GROUP_TYPES[t].label).join(', ')}
                      </Text>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {isOwnWishlist ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => router.push(`/wishlist/edit/${item.id}`)}
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleDelete}
                    loading={isDeleting}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </>
              ) : canClaim && !item.claimed_by && onClaim ? (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => onClaim(item.id)}
                >
                  Claim
                </Button>
              ) : canClaim && item.claimed_by && onUnclaim ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onUnclaim(item.id)}
                >
                  Unclaim
                </Button>
              ) : null}

              {item.url && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(item.url!, '_blank')}
                >
                  <ExternalLink className="w-4 h-4" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
