import Link from "next/link";
import { ArrowRight, Plus, Lock } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { getMyGroups } from "@/lib/actions/groups";
import { getMyWishlist } from "@/lib/actions/wishlist";
import { getMyGroupGifts } from "@/lib/actions/gifts";
import { GroupGiftCard } from "@/components/gifts/GiftGroupCard";
import { GiftExchangeCard } from "@/components/gift-exchange/GiftExchangeCard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GROUP_TYPES } from "@/types/privacy";
import type { GroupType } from "@/types/privacy";

// Simple Group Card Component
function GroupCard({ group }: { group: any }) {
  return (
    <Link href={`/groups/${group.id}`}>
      <div className="p-4 rounded-lg border border-light-border dark:border-dark-border hover:border-primary dark:hover:border-primary transition-colors bg-light-background dark:bg-dark-background-secondary h-full">
        <Heading level="h4" className="mb-2">{group.name}</Heading>
        {group.description && (
          <Text variant="secondary" size="sm" className="line-clamp-2 mb-3">
            {group.description}
          </Text>
        )}
        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded text-xs font-medium bg-light-background-hover dark:bg-dark-background-hover text-light-text-secondary dark:text-dark-text-secondary capitalize">
            {group.type}
          </span>
          {group.myRole === "owner" && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary">
              Owner
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

// Simple Wishlist Card Component
function WishlistCard({ item }: { item: any }) {
  const visibleToGroupTypes = item.privacy_settings?.visibleToGroupTypes || [];
  const restrictToGroup = item.privacy_settings?.restrictToGroup;
  const isPrivate = visibleToGroupTypes.length === 0 && !restrictToGroup;

  return (
    <Link href={`/wishlist`}>
      <div className="p-4 rounded-lg border border-light-border dark:border-dark-border hover:border-primary dark:hover:border-primary transition-colors bg-light-background dark:bg-dark-background-secondary h-full flex flex-col">
        <Heading level="h4" className="mb-2 line-clamp-1">{item.title}</Heading>
        {item.description && (
          <Text variant="secondary" size="sm" className="line-clamp-2 mb-3">
            {item.description}
          </Text>
        )}
        <div className="flex items-center gap-2 mb-3">
          {item.price && (
            <Text className="font-semibold text-primary">
              ${parseFloat(item.price).toFixed(2)}
            </Text>
          )}
          {item.priority && (
            <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${
              item.priority === 'must-have' ? 'bg-error-light dark:bg-error-dark text-error' :
              item.priority === 'high' ? 'bg-warning-light dark:bg-warning-dark text-warning' :
              item.priority === 'medium' ? 'bg-primary-light text-primary' :
              'bg-light-background-hover dark:bg-dark-background-hover text-light-text-secondary dark:text-dark-text-secondary'
            }`}>
              {item.priority}
            </span>
          )}
        </div>
        <hr className="border-t border-light-border dark:border-dark-border mb-3" />
        {/* Privacy indicator */}
        <div className="flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-light-text-secondary dark:text-dark-text-secondary" />
          <Text size="sm" variant="secondary">
            {isPrivate
              ? 'Private'
              : restrictToGroup
              ? 'Restricted to 1 group'
              : `${visibleToGroupTypes.map((t: GroupType) => GROUP_TYPES[t].label).join(', ')}`
            }
          </Text>
        </div>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  // Fetch data
  const supabase = await createClient();
  const adminClient = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  const { data: groups = [] } = await getMyGroups();
  const { data: wishlistItems = [] } = await getMyWishlist();
  const { data: groupGifts = [] } = await getMyGroupGifts();

  // Extract group IDs
  const groupIds = groups.map((g) => g.id);

  // Get member counts for group gifts using admin client
  const groupGiftsWithCounts = await Promise.all(
    groupGifts.slice(0, 3).map(async (groupGift) => {
      const { count } = await adminClient
        .from("group_gift_members")
        .select("*", { count: "exact", head: true })
        .eq("group_gift_id", groupGift.id);

      return {
        ...groupGift,
        memberCount: count || 0,
      };
    })
  );

  // Get gift exchanges for user's groups
  const { data: allExchanges = [] } = await supabase
    .from("gift_exchanges")
    .select("*")
    .in("group_id", groupIds.length > 0 ? groupIds : [""])
    .eq("is_active", true)
    .order("created_at", { ascending: false });

  // Get participant counts and participation status for each exchange
  const exchangesWithData = await Promise.all(
    (allExchanges || []).slice(0, 3).map(async (exchange) => {
      const { count } = await supabase
        .from("gift_exchange_participants")
        .select("*", { count: "exact", head: true })
        .eq("exchange_id", exchange.id)
        .eq("opted_in", true);

      const { data: myParticipation } = await supabase
        .from("gift_exchange_participants")
        .select("id")
        .eq("exchange_id", exchange.id)
        .eq("user_id", user.id)
        .eq("opted_in", true)
        .single();

      return {
        ...exchange,
        participantCount: count || 0,
        isParticipating: !!myParticipation,
      };
    })
  );

  // Limit to 3 items for preview
  const previewGroups = groups.slice(0, 3);
  const previewWishlist = wishlistItems.slice(0, 3);
  const previewGroupGifts = groupGiftsWithCounts;
  const previewGiftExchanges = exchangesWithData;

  return (
    <div className="space-y-10">
      {/* Header */}
      <div>
        <Heading level="h1">Dashboard</Heading>
        <Text variant="secondary" className="mt-1">
          Welcome to Rybn - your gift coordination hub
        </Text>
      </div>

      {/* Groups Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Your Groups</Heading>
          <div className="flex items-center gap-2">
            <Link href="/groups/create">
              <Button variant="secondary" size="small">
                <Plus className="w-4 h-4" />
                Create
              </Button>
            </Link>
            {groups.length > 3 && (
              <Link href="/groups">
                <Button variant="tertiary" size="small">
                  See All ({groups.length})
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {previewGroups.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {previewGroups.map((group) => (
              <GroupCard key={group.id} group={group} />
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
            <Text variant="secondary">No groups yet</Text>
            <Link href="/groups/create">
              <Button variant="primary" size="small" className="mt-3">
                <Plus className="w-4 h-4" />
                Create Your First Group
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Wishlist Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Your Wishlist</Heading>
          <div className="flex items-center gap-2">
            <Link href="/wishlist/add">
              <Button variant="secondary" size="small">
                <Plus className="w-4 h-4" />
                Add Item
              </Button>
            </Link>
            {wishlistItems.length > 3 && (
              <Link href="/wishlist">
                <Button variant="tertiary" size="small">
                  See All ({wishlistItems.length})
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {previewWishlist.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {previewWishlist.map((item) => (
              <WishlistCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
            <Text variant="secondary">No wishlist items yet</Text>
            <Link href="/wishlist/add">
              <Button variant="primary" size="small" className="mt-3">
                <Plus className="w-4 h-4" />
                Add Your First Item
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Group Gifts Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Group Gifts</Heading>
          <div className="flex items-center gap-2">
            <Link href="/gifts/create">
              <Button variant="secondary" size="small">
                <Plus className="w-4 h-4" />
                Create
              </Button>
            </Link>
            {groupGifts.length > 3 && (
              <Link href="/gifts">
                <Button variant="tertiary" size="small">
                  See All ({groupGifts.length})
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {previewGroupGifts.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {previewGroupGifts.map((groupGift) => (
              <GroupGiftCard
                key={groupGift.id}
                groupGift={groupGift}
                memberCount={groupGift.memberCount}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
            <Text variant="secondary">No group gifts yet</Text>
            <Link href="/gifts/create">
              <Button variant="primary" size="small" className="mt-3">
                <Plus className="w-4 h-4" />
                Create Your First Group Gift
              </Button>
            </Link>
          </div>
        )}
      </div>

      {/* Gift Exchange Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Gift Exchanges</Heading>
          <div className="flex items-center gap-2">
            <Link href="/gift-exchange/create">
              <Button variant="secondary" size="small">
                <Plus className="w-4 h-4" />
                Create
              </Button>
            </Link>
            {(allExchanges || []).length > 3 && (
              <Link href="/gift-exchange">
                <Button variant="tertiary" size="small">
                  See All ({(allExchanges || []).length})
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {previewGiftExchanges.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {previewGiftExchanges.map((exchange) => (
              <GiftExchangeCard
                key={exchange.id}
                exchange={exchange}
                participantCount={exchange.participantCount}
                isParticipating={exchange.isParticipating}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
            <Text variant="secondary">No gift exchanges yet</Text>
            <Link href="/gift-exchange/create">
              <Button variant="primary" size="small" className="mt-3">
                <Plus className="w-4 h-4" />
                Create Your First Gift Exchange
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
