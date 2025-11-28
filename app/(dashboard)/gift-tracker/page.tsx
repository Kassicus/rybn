import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getRecipientsWithStats,
  getAllMyGifts,
  getGiftTrackingStats,
} from "@/lib/actions/gift-tracking";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { RecipientCard, EmptyState } from "@/components/gift-tracking";
import { UserPlus } from "lucide-react";
import Link from "next/link";
import type { GiftStatus } from "@/lib/schemas/gift-tracking";

export default async function GiftTrackerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [recipientsResult, giftsResult, statsResult] = await Promise.all([
    getRecipientsWithStats(),
    getAllMyGifts(),
    getGiftTrackingStats(),
  ]);

  if (recipientsResult.error) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-error">Error loading recipients: {recipientsResult.error}</p>
      </div>
    );
  }

  const recipients = recipientsResult.data || [];
  const gifts = (giftsResult.data || []) as Array<{
    id: string;
    recipient_id: string;
    name: string;
    description: string | null;
    photo_url: string | null;
    product_link: string | null;
    price: number | null;
    status: GiftStatus;
    occasion: string | null;
  }>;
  const stats = statsResult.data;

  // Group gifts by recipient
  const giftsByRecipient = gifts.reduce(
    (acc, gift) => {
      if (!acc[gift.recipient_id]) {
        acc[gift.recipient_id] = [];
      }
      acc[gift.recipient_id].push(gift);
      return acc;
    },
    {} as Record<string, typeof gifts>
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <Heading level="h1">Gift Tracker</Heading>
          <Text variant="secondary">
            Track gifts you&apos;re getting for others
          </Text>
        </div>
        <Link href="/gift-tracker/add-recipient">
          <Button variant="primary">
            <UserPlus className="w-4 h-4 mr-2" />
            Add Recipient
          </Button>
        </Link>
      </div>

      {/* Stats Summary */}
      {stats && recipients.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="p-4 rounded-lg bg-light-background border border-light-border">
            <Text variant="secondary" size="sm">Total Spent</Text>
            <Text className="text-2xl font-bold text-primary">
              ${stats.totalCost.toFixed(2)}
            </Text>
          </div>
          <div className="p-4 rounded-lg bg-light-background border border-light-border">
            <Text variant="secondary" size="sm">Planned Spending</Text>
            <Text className="text-2xl font-bold text-warning">
              ${stats.byStatus.planned.total.toFixed(2)}
            </Text>
          </div>
          <div className="p-4 rounded-lg bg-light-background border border-light-border">
            <Text variant="secondary" size="sm">Total Gifts</Text>
            <Text className="text-2xl font-bold">{stats.giftCount}</Text>
          </div>
          <div className="p-4 rounded-lg bg-light-background border border-light-border">
            <Text variant="secondary" size="sm">Recipients</Text>
            <Text className="text-2xl font-bold">{stats.recipientCount}</Text>
          </div>
          <div className="p-4 rounded-lg bg-light-background border border-light-border">
            <Text variant="secondary" size="sm">Completed</Text>
            <Text className="text-2xl font-bold text-success">
              {stats.byStatus.wrapped.count + stats.byStatus.given.count}
            </Text>
          </div>
        </div>
      )}

      {/* Empty State */}
      {recipients.length === 0 && <EmptyState type="recipients" />}

      {/* Recipients List */}
      {recipients.length > 0 && (
        <div className="space-y-4">
          {recipients.map((recipient) => (
            <RecipientCard
              key={recipient.id}
              recipient={recipient}
              gifts={giftsByRecipient[recipient.id] || []}
              defaultExpanded={recipients.length === 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
