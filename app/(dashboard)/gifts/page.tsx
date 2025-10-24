import { Gift, Plus } from "lucide-react";
import Link from "next/link";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { GiftGroupCard } from "@/components/gifts/GiftGroupCard";
import { getMyGiftGroups } from "@/lib/actions/gifts";
import { createClient } from "@/lib/supabase/server";

export default async function GiftsPage() {
  const { data: giftGroups = [] } = await getMyGiftGroups();
  const supabase = await createClient();

  // Get member counts for each gift group
  const giftGroupsWithCounts = await Promise.all(
    giftGroups.map(async (giftGroup) => {
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

  // Separate active and inactive gift groups
  const activeGiftGroups = giftGroupsWithCounts.filter((gg) => gg.is_active);
  const inactiveGiftGroups = giftGroupsWithCounts.filter((gg) => !gg.is_active);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Gift Groups</Heading>
          <Text variant="secondary" className="mt-1">
            Coordinate group gifts with friends and family
          </Text>
        </div>
        <Link href="/gifts/create">
          <Button variant="primary">
            <Plus className="w-4 h-4" />
            New Gift Group
          </Button>
        </Link>
      </div>

      {/* Active Gift Groups */}
      {activeGiftGroups.length > 0 ? (
        <div className="space-y-4">
          <Heading level="h3">Active Gift Groups</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeGiftGroups.map((giftGroup) => (
              <GiftGroupCard
                key={giftGroup.id}
                giftGroup={giftGroup}
                memberCount={giftGroup.memberCount}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center mb-4">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <Heading level="h3" className="mb-2">
            No gift groups yet
          </Heading>
          <Text variant="secondary" className="max-w-md mb-6">
            Create a gift group to coordinate with others on a group gift. Pool money together and plan the perfect present!
          </Text>
          <Link href="/gifts/create">
            <Button variant="primary">
              <Plus className="w-4 h-4" />
              Create Your First Gift Group
            </Button>
          </Link>
        </div>
      )}

      {/* Inactive Gift Groups */}
      {inactiveGiftGroups.length > 0 && (
        <div className="space-y-4">
          <Heading level="h3">Inactive Gift Groups</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inactiveGiftGroups.map((giftGroup) => (
              <GiftGroupCard
                key={giftGroup.id}
                giftGroup={giftGroup}
                memberCount={giftGroup.memberCount}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
