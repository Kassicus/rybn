import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { getMyGroups } from "@/lib/actions/groups";
import { getMyWishlist } from "@/lib/actions/wishlist";
import { getMyGiftGroups } from "@/lib/actions/gifts";
import { GiftGroupCard } from "@/components/gifts/GiftGroupCard";
import { createClient } from "@/lib/supabase/server";

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
  return (
    <Link href={`/wishlist`}>
      <div className="p-4 rounded-lg border border-light-border dark:border-dark-border hover:border-primary dark:hover:border-primary transition-colors bg-light-background dark:bg-dark-background-secondary h-full">
        <Heading level="h4" className="mb-2 line-clamp-1">{item.title}</Heading>
        {item.description && (
          <Text variant="secondary" size="sm" className="line-clamp-2 mb-3">
            {item.description}
          </Text>
        )}
        <div className="flex items-center justify-between">
          {item.price && (
            <Text className="font-semibold text-primary">
              ${parseFloat(item.price).toFixed(2)}
            </Text>
          )}
          {item.priority && (
            <span className={`px-2 py-1 rounded text-xs font-medium capitalize ${
              item.priority === 'must-have' ? 'bg-error-light text-error' :
              item.priority === 'high' ? 'bg-warning-light text-warning' :
              item.priority === 'medium' ? 'bg-primary-light text-primary' :
              'bg-light-background-hover dark:bg-dark-background-hover text-light-text-secondary dark:text-dark-text-secondary'
            }`}>
              {item.priority}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export default async function DashboardPage() {
  // Fetch data
  const { data: groups = [] } = await getMyGroups();
  const { data: wishlistItems = [] } = await getMyWishlist();
  const { data: giftGroups = [] } = await getMyGiftGroups();
  const supabase = await createClient();

  // Get member counts for gift groups
  const giftGroupsWithCounts = await Promise.all(
    giftGroups.slice(0, 3).map(async (giftGroup) => {
      const { count } = await supabase
        .from("gift_group_members")
        .select("*", { count: "exact", head: true })
        .eq("gift_group_id", giftGroup.id);

      return {
        ...giftGroup,
        memberCount: count || 0,
      };
    })
  );

  // Limit to 3 items for preview
  const previewGroups = groups.slice(0, 3);
  const previewWishlist = wishlistItems.slice(0, 3);
  const previewGiftGroups = giftGroupsWithCounts;

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

      {/* Gift Groups Section */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <Heading level="h2">Gift Groups</Heading>
          <div className="flex items-center gap-2">
            <Link href="/gifts/create">
              <Button variant="secondary" size="small">
                <Plus className="w-4 h-4" />
                Create
              </Button>
            </Link>
            {giftGroups.length > 3 && (
              <Link href="/gifts">
                <Button variant="tertiary" size="small">
                  See All ({giftGroups.length})
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            )}
          </div>
        </div>

        {previewGiftGroups.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {previewGiftGroups.map((giftGroup) => (
              <GiftGroupCard
                key={giftGroup.id}
                giftGroup={giftGroup}
                memberCount={giftGroup.memberCount}
              />
            ))}
          </div>
        ) : (
          <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
            <Text variant="secondary">No gift groups yet</Text>
            <Link href="/gifts/create">
              <Button variant="primary" size="small" className="mt-3">
                <Plus className="w-4 h-4" />
                Create Your First Gift Group
              </Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
