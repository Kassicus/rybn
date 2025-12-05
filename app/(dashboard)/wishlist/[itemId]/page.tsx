"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Circle, Lock, ExternalLink } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { WishlistItemSettings } from "@/components/wishlist/WishlistItemSettings";
import { ClaimActions } from "@/components/wishlist/ClaimActions";
import { getWishlistItem, getClaimerProfile } from "@/lib/actions/wishlist";
import { createClient } from "@/lib/supabase/client";
import { PRIORITY_INFO } from "@/lib/schemas/wishlist";
import { GROUP_TYPES } from "@/types/privacy";
import type { GroupType } from "@/types/privacy";

interface ClaimerInfo {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface WishlistItem {
  id: string;
  user_id: string;
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


export default function WishlistItemDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = use(params);
  const [item, setItem] = useState<WishlistItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwnWishlist, setIsOwnWishlist] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [claimerInfo, setClaimerInfo] = useState<ClaimerInfo | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function loadData() {
      const { data: itemData, error: itemError, currentUserId: userId } =
        await getWishlistItem(itemId);

      if (itemError || !itemData) {
        router.push("/404");
        return;
      }

      if (!userId) {
        router.push("/404");
        return;
      }

      setItem(itemData as any);
      setCurrentUserId(userId);
      setIsOwnWishlist(itemData.user_id === userId);

      // Fetch claimer info if claimed and not own item
      if (itemData.claimed_by && itemData.user_id !== userId) {
        const { data: claimer } = await getClaimerProfile(itemData.claimed_by);
        if (claimer) {
          setClaimerInfo(claimer);
        }
      }

      setLoading(false);
    }

    loadData();
  }, [itemId, router]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="h-12 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (!item) {
    return null;
  }
  const priorityInfo = PRIORITY_INFO[item.priority];

  const visibleToGroupTypes = item.privacy_settings?.visibleToGroupTypes || [];
  const restrictToGroup = item.privacy_settings?.restrictToGroup;
  const isPrivate = visibleToGroupTypes.length === 0 && !restrictToGroup;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "My Wishlist", href: "/wishlist" },
          { label: item.title, href: `/wishlist/${item.id}` },
        ]}
      />
      {/* Header */}
      <div>
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Heading level="h1">{item.title}</Heading>
              {item.claimed_by && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-green-100 text-green-700">
                  Claimed
                </span>
              )}
              {item.purchased && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-blue-100 text-blue-700">
                  Purchased
                </span>
              )}
              {item.out_of_stock_marked_by && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-red-100 text-red-700">
                  Out of Stock
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Circle className="w-5 h-5" style={{ color: priorityInfo.hexColor }} fill="currentColor" />
                <Text style={{ color: priorityInfo.hexColor }}>
                  {priorityInfo.label}
                </Text>
              </div>

              {item.price && (
                <Text className="font-medium">
                  ${item.price.toFixed(2)}
                </Text>
              )}

              {item.category && (
                <span className="px-2 py-1 rounded text-sm bg-light-background-hover">
                  {item.category}
                </span>
              )}
            </div>
          </div>

          {isOwnWishlist && (
            <WishlistItemSettings
              itemId={item.id}
              itemTitle={item.title}
              item={item}
            />
          )}
        </div>
      </div>

      <Separator />

      {/* Item Details */}
      <div className="space-y-6">
        {/* Image */}
        {item.image_url && (
          <div className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-gray-100">
            <img
              src={item.image_url}
              alt={item.title}
              className="w-full h-auto object-contain"
            />
          </div>
        )}

        {/* Description */}
        {item.description && (
          <div>
            <Heading level="h3" className="mb-2">Description</Heading>
            <Text variant="secondary">{item.description}</Text>
          </div>
        )}

        {/* Links and Actions */}
        <div className="flex flex-wrap gap-3">
          {item.url && (
            <Button
              variant="secondary"
              onClick={() => window.open(item.url!, "_blank")}
            >
              <ExternalLink className="w-4 h-4" />
              View Product
            </Button>
          )}
        </div>

        {/* Claim Actions - only for non-owners */}
        {!isOwnWishlist && currentUserId && (
          <ClaimActions
            itemId={item.id}
            claimedBy={item.claimed_by || null}
            purchased={item.purchased || false}
            outOfStockMarkedBy={item.out_of_stock_marked_by || null}
            currentUserId={currentUserId}
            claimerInfo={claimerInfo}
            variant="detail"
            itemData={{
              title: item.title,
              description: item.description,
              url: item.url,
              price: item.price,
              image_url: item.image_url,
            }}
          />
        )}

        {/* Privacy Settings - only for owners */}
        {isOwnWishlist && (
          <div className="p-4 rounded-lg border border-light-border bg-light-background-hover">
            <Heading level="h4" className="mb-2">Privacy</Heading>
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-gray-500" />
              <Text variant="secondary">
                {isPrivate
                  ? "Private: Only you can see this item"
                  : restrictToGroup
                  ? "Restricted to a specific group"
                  : `Visible to: ${visibleToGroupTypes
                      .map((t) => GROUP_TYPES[t].label)
                      .join(", ")} groups`}
              </Text>
            </div>
          </div>
        )}

        {/* Additional Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-light-border">
            <Text variant="secondary" size="sm" className="mb-1">Priority</Text>
            <div className="flex items-center gap-2">
              <Circle className="w-5 h-5" style={{ color: priorityInfo.hexColor }} fill="currentColor" />
              <Text className="font-medium" style={{ color: priorityInfo.hexColor }}>
                {priorityInfo.label}
              </Text>
            </div>
            <Text variant="secondary" size="sm" className="mt-1">
              {priorityInfo.description}
            </Text>
          </div>

          {item.price && (
            <div className="p-4 rounded-lg border border-light-border">
              <Text variant="secondary" size="sm" className="mb-1">Estimated Price</Text>
              <Text className="font-medium text-lg">
                ${item.price.toFixed(2)}
              </Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
