import { Gift, Plus } from "lucide-react";
import Link from "next/link";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { GiftExchangeCard } from "@/components/gift-exchange/GiftExchangeCard";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function GiftExchangePage() {
  const supabase = await createClient();
  const adminClient = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return null;
  }

  // Get all groups the user is a member of
  const { data: userGroups } = await supabase
    .from("group_members")
    .select("group_id")
    .eq("user_id", user.id);

  const groupIds = userGroups?.map((g) => g.group_id) || [];

  if (groupIds.length === 0) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Heading level="h1">Gift Exchanges</Heading>
            <Text variant="secondary" className="mt-1">
              Secret Santa, White Elephant, and more
            </Text>
          </div>
        </div>

        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center mb-4">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <Heading level="h3" className="mb-2">
            No groups yet
          </Heading>
          <Text variant="secondary" className="max-w-md mb-6">
            You need to join or create a group before you can participate in gift exchanges.
          </Text>
          <Link href="/groups/create">
            <Button variant="primary">
              <Plus className="w-4 h-4" />
              Create a Group
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  // Get all gift exchanges for user's groups
  const { data: allExchanges = [] } = await supabase
    .from("gift_exchanges")
    .select("*")
    .in("group_id", groupIds)
    .order("created_at", { ascending: false });

  // Get participant counts and participation status for each exchange using admin client
  const exchangesWithData = await Promise.all(
    (allExchanges || []).map(async (exchange) => {
      const { count } = await adminClient
        .from("gift_exchange_participants")
        .select("*", { count: "exact", head: true })
        .eq("exchange_id", exchange.id)
        .eq("opted_in", true);

      const { data: myParticipation } = await adminClient
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

  // Separate active and inactive exchanges
  const activeExchanges = exchangesWithData.filter((e) => e.is_active);
  const inactiveExchanges = exchangesWithData.filter((e) => !e.is_active);

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Gift Exchanges</Heading>
          <Text variant="secondary" className="mt-1">
            Secret Santa, White Elephant, and more
          </Text>
        </div>
        <Link href="/gift-exchange/create">
          <Button variant="primary">
            <Plus className="w-4 h-4" />
            New Gift Exchange
          </Button>
        </Link>
      </div>

      {/* Active Exchanges */}
      {activeExchanges.length > 0 ? (
        <div className="space-y-4">
          <Heading level="h3">Active Exchanges</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeExchanges.map((exchange) => (
              <GiftExchangeCard
                key={exchange.id}
                exchange={exchange}
                participantCount={exchange.participantCount}
                isParticipating={exchange.isParticipating}
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
            No gift exchanges yet
          </Heading>
          <Text variant="secondary" className="max-w-md mb-6">
            Create a gift exchange to coordinate Secret Santa, White Elephant, or any other gift exchange with your groups!
          </Text>
          <Link href="/gift-exchange/create">
            <Button variant="primary">
              <Plus className="w-4 h-4" />
              Create Your First Gift Exchange
            </Button>
          </Link>
        </div>
      )}

      {/* Inactive Exchanges */}
      {inactiveExchanges.length > 0 && (
        <div className="space-y-4">
          <Heading level="h3">Past Exchanges</Heading>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {inactiveExchanges.map((exchange) => (
              <GiftExchangeCard
                key={exchange.id}
                exchange={exchange}
                participantCount={exchange.participantCount}
                isParticipating={exchange.isParticipating}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
