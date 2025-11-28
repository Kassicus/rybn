import { Gift, Plus } from "lucide-react";
import Link from "next/link";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { GroupGiftCard } from "@/components/gifts/GiftGroupCard";
import { getMyGroupGifts } from "@/lib/actions/gifts";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function GiftsPage() {
  const { data: groupGifts = [] } = await getMyGroupGifts();
  const adminClient = createAdminClient();

  // Get member counts for each group gift using admin client
  const groupGiftsWithCounts = await Promise.all(
    groupGifts.map(async (groupGift) => {
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

  // Separate active and inactive group gifts
  const activeGroupGifts = groupGiftsWithCounts.filter((gg) => gg.is_active);
  const inactiveGroupGifts = groupGiftsWithCounts.filter((gg) => !gg.is_active);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Group Gifts", href: "/gifts" },
        ]}
      />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Group Gifts</Heading>
          <Text variant="secondary" className="mt-1">
            Pool money together with friends and family for group gifts
          </Text>
        </div>
        <Link href="/gifts/create">
          <Button variant="primary">
            <Plus className="w-4 h-4" />
            New Group Gift
          </Button>
        </Link>
      </div>

      {/* Active Group Gifts */}
      {activeGroupGifts.length > 0 ? (
        <div className="space-y-4">
          <Heading level="h3">Active Group Gifts</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeGroupGifts.map((groupGift) => (
              <GroupGiftCard
                key={groupGift.id}
                groupGift={groupGift}
                memberCount={groupGift.memberCount}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mb-4">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <Heading level="h3" className="mb-2">
            No group gifts yet
          </Heading>
          <Text variant="secondary" className="max-w-md mb-6">
            Create a group gift to pool money together with others. Coordinate contributions and plan the perfect present!
          </Text>
          <Link href="/gifts/create">
            <Button variant="primary">
              <Plus className="w-4 h-4" />
              Create Your First Group Gift
            </Button>
          </Link>
        </div>
      )}

      {/* Inactive Group Gifts */}
      {inactiveGroupGifts.length > 0 && (
        <div className="space-y-4">
          <Heading level="h3">Inactive Group Gifts</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inactiveGroupGifts.map((groupGift) => (
              <GroupGiftCard
                key={groupGift.id}
                groupGift={groupGift}
                memberCount={groupGift.memberCount}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
