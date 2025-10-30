"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Star, Circle, CircleDot, CircleDashed, Lock, ExternalLink } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { WishlistItemSettings } from "@/components/wishlist/WishlistItemSettings";
import { getWishlistItem } from "@/lib/actions/wishlist";
import { createClient } from "@/lib/supabase/client";
import { PRIORITY_INFO } from "@/lib/schemas/wishlist";
import { GROUP_TYPES } from "@/types/privacy";
import type { GroupType } from "@/types/privacy";

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
}

const priorityIcons = {
  'low': CircleDashed,
  'medium': Circle,
  'high': CircleDot,
  'must-have': Star,
};

export default function WishlistItemDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { itemId } = use(params);
  const [item, setItem] = useState<WishlistItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [isOwnWishlist, setIsOwnWishlist] = useState(false);
  const router = useRouter();

  useEffect(() => {
    async function loadData() {
      const supabase = createClient();

      const { data: itemData, error: itemError } = await getWishlistItem(itemId);

      if (itemError || !itemData) {
        router.push('/404');
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/404');
        return;
      }

      setItem(itemData);
      setIsOwnWishlist(itemData.user_id === user.id);
      setLoading(false);
    }

    loadData();
  }, [itemId, router]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
          <div className="h-12 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  if (!item) {
    return null;
  }
  const priorityInfo = PRIORITY_INFO[item.priority];
  const PriorityIcon = priorityIcons[item.priority];

  const visibleToGroupTypes = item.privacy_settings?.visibleToGroupTypes || [];
  const restrictToGroup = item.privacy_settings?.restrictToGroup;
  const isPrivate = visibleToGroupTypes.length === 0 && !restrictToGroup;

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/wishlist"
          className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <Text size="sm">Back to Wishlist</Text>
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Heading level="h1">{item.title}</Heading>
              {item.claimed_by && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                  Claimed
                </span>
              )}
              {item.purchased && !isOwnWishlist && (
                <span className="px-2 py-1 rounded text-sm bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300">
                  Purchased
                </span>
              )}
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <div className="flex items-center gap-1.5">
                <PriorityIcon className={`w-5 h-5 ${priorityInfo.color}`} />
                <Text className={priorityInfo.color}>
                  {priorityInfo.label}
                </Text>
              </div>

              {item.price && (
                <Text className="font-medium">
                  ${item.price.toFixed(2)}
                </Text>
              )}

              {item.category && (
                <span className="px-2 py-1 rounded text-sm bg-light-background-hover dark:bg-dark-background-hover">
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
          <div className="w-full max-w-md mx-auto rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
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
              onClick={() => window.open(item.url!, '_blank')}
            >
              <ExternalLink className="w-4 h-4" />
              View Product
            </Button>
          )}
        </div>

        {/* Privacy Settings */}
        <div className="p-4 rounded-lg border border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover">
          <Heading level="h4" className="mb-2">Privacy</Heading>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-gray-500" />
            <Text variant="secondary">
              {isPrivate ? (
                '🔒 Private: Only you can see this item'
              ) : restrictToGroup ? (
                '🔐 Restricted to a specific group'
              ) : (
                `✓ Visible to: ${visibleToGroupTypes.map(t => GROUP_TYPES[t].label).join(', ')} groups`
              )}
            </Text>
          </div>
        </div>

        {/* Additional Details */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
            <Text variant="secondary" size="sm" className="mb-1">Priority</Text>
            <div className="flex items-center gap-2">
              <PriorityIcon className={`w-5 h-5 ${priorityInfo.color}`} />
              <Text className={`font-medium ${priorityInfo.color}`}>
                {priorityInfo.label}
              </Text>
            </div>
            <Text variant="secondary" size="sm" className="mt-1">
              {priorityInfo.description}
            </Text>
          </div>

          {item.price && (
            <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
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
