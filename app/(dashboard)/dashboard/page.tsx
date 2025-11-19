import Link from "next/link";
import { ArrowRight, Plus, Lock, Users, Gift, Calendar, ListPlus } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { HeroBanner } from "@/components/layout/HeroBanner";
import { getMyGroups } from "@/lib/actions/groups";
import { getMyWishlist } from "@/lib/actions/wishlist";
import { getMyGroupGifts } from "@/lib/actions/gifts";
import { getMyProfile } from "@/lib/actions/profile";
import { GroupGiftCard } from "@/components/gifts/GiftGroupCard";
import { GiftExchangeCard } from "@/components/gift-exchange/GiftExchangeCard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { GROUP_TYPES } from "@/types/privacy";
import type { GroupType } from "@/types/privacy";
import JoinGroupButton from "@/components/groups/JoinGroupButton";

// Simple Group Card Component
function GroupCard({ group }: { group: any }) {
  return (
    <Link href={`/groups/${group.id}`}>
      <div className="p-6 rounded-2xl border border-light-border hover:border-primary transition-all duration-200 bg-light-background h-full hover:shadow-lg hover:-translate-y-1">
        <Heading level="h4" className="mb-2">{group.name}</Heading>
        {group.description && (
          <Text variant="secondary" size="sm" className="line-clamp-2 mb-3">
            {group.description}
          </Text>
        )}
        <div className="flex items-center gap-2">
          <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-light-background-hover text-light-text-secondary capitalize">
            {group.type}
          </span>
          {group.myRole === "owner" && (
            <span className="px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-100 text-primary">
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
      <div className="p-6 rounded-2xl border border-light-border hover:border-primary transition-all duration-200 bg-light-background h-full flex flex-col hover:shadow-lg hover:-translate-y-1">
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
            <span className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
              item.priority === 'must-have' ? 'bg-error-light text-error' :
              item.priority === 'high' ? 'bg-warning-light text-warning' :
              item.priority === 'medium' ? 'bg-primary-light text-primary' :
              'bg-light-background-hover text-light-text-secondary'
            }`}>
              {item.priority}
            </span>
          )}
        </div>
        <hr className="border-t border-light-border mb-3" />
        {/* Privacy indicator */}
        <div className="flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-light-text-secondary" />
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

  const { data: profile } = await getMyProfile();
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
    <div className="space-y-8">
      {/* Hero Banner */}
      <HeroBanner
        userName={profile?.display_name || profile?.username}
        stats={{
          upcomingEvents: exchangesWithData.length,
          activeGifts: groupGifts.length,
          groupCount: groups.length,
        }}
      />

      {/* Quick Actions */}
      <div>
        <Heading level="h3" className="mb-4">Quick Actions</Heading>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link href="/gifts/create">
            <Button
              variant="secondary"
              size="large"
              className="w-full h-24 rounded-2xl flex-col gap-2"
            >
              <Gift className="w-6 h-6" />
              <span>Create Group Gift</span>
            </Button>
          </Link>

          <Link href="/gift-exchange/create">
            <Button
              variant="secondary"
              size="large"
              className="w-full h-24 rounded-2xl flex-col gap-2"
            >
              <Calendar className="w-6 h-6" />
              <span>Start Gift Exchange</span>
            </Button>
          </Link>

          <Link href="/wishlist/add">
            <Button
              variant="secondary"
              size="large"
              className="w-full h-24 rounded-2xl flex-col gap-2"
            >
              <ListPlus className="w-6 h-6" />
              <span>Add to Wishlist</span>
            </Button>
          </Link>
        </div>
      </div>

      {/* 2x2 Navigation Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Groups */}
        <Link href="/groups" className="group">
          <div className="p-8 rounded-2xl border border-light-border hover:border-primary transition-all duration-200 bg-light-background h-full hover:shadow-lg hover:-translate-y-1">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 rounded-xl bg-success/10 group-hover:bg-success/20 transition-colors">
                <Users className="w-8 h-8 text-success" />
              </div>
              <Heading level="h2">Groups</Heading>
            </div>
            <Text variant="secondary" size="lg" className="mb-6">
              {groups.length} {groups.length === 1 ? "group" : "groups"}
            </Text>
            <div className="flex items-center gap-2 text-primary">
              <Text className="font-medium">View All</Text>
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        </Link>

        {/* Group Gifts */}
        <Link href="/gifts" className="group">
          <div className="p-8 rounded-2xl border border-light-border hover:border-primary transition-all duration-200 bg-light-background h-full hover:shadow-lg hover:-translate-y-1">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 rounded-xl bg-warning/10 group-hover:bg-warning/20 transition-colors">
                <Gift className="w-8 h-8 text-warning" />
              </div>
              <Heading level="h2">Group Gifts</Heading>
            </div>
            <Text variant="secondary" size="lg" className="mb-6">
              {groupGifts.length} active {groupGifts.length === 1 ? "gift" : "gifts"}
            </Text>
            <div className="flex items-center gap-2 text-primary">
              <Text className="font-medium">View All</Text>
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        </Link>

        {/* Exchanges */}
        <Link href="/gift-exchange" className="group">
          <div className="p-8 rounded-2xl border border-light-border hover:border-primary transition-all duration-200 bg-light-background h-full hover:shadow-lg hover:-translate-y-1">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 rounded-xl bg-error/10 group-hover:bg-error/20 transition-colors">
                <Calendar className="w-8 h-8 text-error" />
              </div>
              <Heading level="h2">Exchanges</Heading>
            </div>
            <Text variant="secondary" size="lg" className="mb-6">
              {exchangesWithData.length} active {exchangesWithData.length === 1 ? "exchange" : "exchanges"}
            </Text>
            <div className="flex items-center gap-2 text-primary">
              <Text className="font-medium">View All</Text>
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        </Link>

        {/* My Wishlist */}
        <Link href="/wishlist" className="group">
          <div className="p-8 rounded-2xl border border-light-border hover:border-primary transition-all duration-200 bg-light-background h-full hover:shadow-lg hover:-translate-y-1">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-4 rounded-xl bg-primary/10 group-hover:bg-primary/20 transition-colors">
                <ListPlus className="w-8 h-8 text-primary" />
              </div>
              <Heading level="h2">My Wishlist</Heading>
            </div>
            <Text variant="secondary" size="lg" className="mb-6">
              {wishlistItems.length} {wishlistItems.length === 1 ? "item" : "items"}
            </Text>
            <div className="flex items-center gap-2 text-primary">
              <Text className="font-medium">View All</Text>
              <ArrowRight className="w-5 h-5" />
            </div>
          </div>
        </Link>
      </div>

      {/* Featured Exchange */}
      {previewGiftExchanges.length > 0 ? (
        <div>
          <Heading level="h3" className="mb-4">Featured Exchange</Heading>
          <GiftExchangeCard
            exchange={previewGiftExchanges[0]}
            participantCount={previewGiftExchanges[0].participantCount}
            isParticipating={previewGiftExchanges[0].isParticipating}
          />
        </div>
      ) : (
        <div className="p-12 rounded-2xl border border-light-border border-dashed text-center bg-light-background">
          <Calendar className="w-12 h-12 mx-auto mb-4 text-light-text-secondary" />
          <Heading level="h3" className="mb-2">No Active Exchanges</Heading>
          <Text variant="secondary" className="mb-4">
            Create your first gift exchange to start coordinating gifts with your groups
          </Text>
          <Link href="/gift-exchange/create">
            <Button variant="primary" size="medium">
              <Plus className="w-4 h-4" />
              Create Gift Exchange
            </Button>
          </Link>
        </div>
      )}
    </div>
  );
}
