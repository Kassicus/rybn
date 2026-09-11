import Link from "next/link";
import { ArrowRight, Plus, Users, Gift, Calendar, ListPlus, Package } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { Button } from "@/components/ui/button";
import { HeroBanner } from "@/components/layout/HeroBanner";
import { getMyGroups } from "@/lib/actions/groups";
import { getMyWishlist } from "@/lib/actions/wishlist";
import { getMyGroupGifts } from "@/lib/actions/gifts";
import { getMyProfile } from "@/lib/actions/profile";
import { getGiftTrackingStats } from "@/lib/actions/gift-tracking";
import { getUpcomingOccasions } from "@/lib/actions/occasions";
import { GiftExchangeCard } from "@/components/gift-exchange/GiftExchangeCard";
import { UpcomingOccasions } from "@/components/occasions/UpcomingOccasions";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

import { getUserId } from "@/lib/auth/require-auth";

export default async function DashboardPage() {
  // Fetch data
  const supabase = await createClient();
  const userId = await getUserId();

  if (!userId) {
    return null;
  }

  const { data: profile } = await getMyProfile();
  const { data: groups = [] } = await getMyGroups();
  const { data: wishlistItems = [] } = await getMyWishlist();
  const { data: groupGifts = [] } = await getMyGroupGifts();
  const { data: giftTrackingStats } = await getGiftTrackingStats();
  const { data: upcomingOccasions = [] } = await getUpcomingOccasions();

  // Extract group IDs
  const groupIds = groups.map((g) => g.id);

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
        .eq("user_id", userId)
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
  const previewGiftExchanges = exchangesWithData;

  const navTiles = [
    {
      href: "/groups",
      createHref: "/groups/create",
      createLabel: "New group",
      title: "Groups",
      icon: Users,
      well: "bg-primary-50",
      stroke: "text-primary",
      detail: `${groups.length} ${groups.length === 1 ? "group" : "groups"}`,
    },
    {
      href: "/gifts",
      createHref: "/gifts/create",
      createLabel: "New gift",
      title: "Group Gifts",
      icon: Gift,
      well: "bg-accent-tint",
      stroke: "text-accent",
      detail: `${groupGifts.length} active ${groupGifts.length === 1 ? "gift" : "gifts"}`,
    },
    {
      href: "/gift-tracker",
      createHref: "/gift-tracker/add-recipient",
      createLabel: "Add recipient",
      title: "Gift Tracker",
      icon: Package,
      well: "bg-gold-tint",
      stroke: "text-gold-ink",
      detail: giftTrackingStats
        ? `${giftTrackingStats.giftCount - giftTrackingStats.byStatus.given.count} gifts to give`
        : "Track your gifts",
    },
    {
      href: "/gift-exchange",
      createHref: "/gift-exchange/create",
      createLabel: "New exchange",
      title: "Exchanges",
      icon: Calendar,
      well: "bg-accent-tint",
      stroke: "text-accent",
      detail: `${exchangesWithData.length} active ${exchangesWithData.length === 1 ? "exchange" : "exchanges"}`,
    },
    {
      href: "/wishlist",
      createHref: "/wishlist/add",
      createLabel: "Add item",
      title: "My Wishlist",
      icon: ListPlus,
      well: "bg-primary-50",
      stroke: "text-primary",
      detail: `${wishlistItems.length} ${wishlistItems.length === 1 ? "item" : "items"}`,
    },
  ];

  return (
    <div className="space-y-8">
      <BreadcrumbSetter
        items={[{ label: "Dashboard", href: "/dashboard" }]}
      />
      {/* Hero Banner */}
      <HeroBanner
        userName={profile?.display_name || profile?.username}
        stats={{
          upcomingEvents: exchangesWithData.length,
          activeGifts: groupGifts.length,
          groupCount: groups.length,
        }}
      />

      <UpcomingOccasions occasions={upcomingOccasions} limit={5} />

      {/* One navigation block, not two. Each card IS the destination and
          carries its own create action, so the old "Quick Actions" row --
          which offered three of these same five destinations a second time --
          is gone. */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {navTiles.map((tile) => (
          <div
            key={tile.href}
            className="group relative flex h-full flex-col items-start gap-5 rounded-lg border border-light-border bg-light-background p-6 transition-all duration-200 hover:-translate-y-0.5 hover:border-primary hover:shadow-md focus-within:border-primary"
          >
            <div className={cn("flex h-12 w-12 items-center justify-center rounded-md", tile.well)}>
              <tile.icon className={cn("h-6 w-6", tile.stroke)} />
            </div>

            <div className="flex flex-col gap-1.5">
              <Heading as="h2" level="h4" className="font-display">
                {/* Stretched link: the pseudo-element covers the whole card so
                    it stays one big target, while the create action below sits
                    above it on z-index and remains separately clickable. */}
                <Link
                  href={tile.href}
                  className="rounded-sm after:absolute after:inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {tile.title}
                </Link>
              </Heading>
              <Text variant="secondary">{tile.detail}</Text>
            </div>

            <div className="mt-auto flex w-full items-center justify-between gap-3">
              <span className="flex items-center gap-1.5 text-accent">
                <Text className="font-semibold text-accent">View all</Text>
                <ArrowRight className="h-4 w-4" />
              </span>
              <Link
                href={tile.createHref}
                className="relative z-10 flex items-center gap-1 rounded-sm px-2 py-1 text-sm font-semibold text-ink-soft transition-colors hover:bg-light-background-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <Plus className="h-4 w-4" />
                {tile.createLabel}
              </Link>
            </div>
          </div>
        ))}
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
