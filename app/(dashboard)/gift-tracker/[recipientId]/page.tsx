import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getRecipientById,
  getGiftsForRecipient,
  deleteRecipient,
} from "@/lib/actions/gift-tracking";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { GiftCard, EmptyState } from "@/components/gift-tracking";
import { Plus, Pencil, User } from "lucide-react";
import Link from "next/link";
import type { GiftStatus } from "@/lib/schemas/gift-tracking";

interface PageProps {
  params: Promise<{
    recipientId: string;
  }>;
}

export default async function RecipientDetailPage({ params }: PageProps) {
  const { recipientId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [recipientResult, giftsResult] = await Promise.all([
    getRecipientById(recipientId),
    getGiftsForRecipient(recipientId),
  ]);

  if (recipientResult.error || !recipientResult.data) {
    notFound();
  }

  const recipient = recipientResult.data;
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

  // Only count spending for gifts that have been ordered (not just planned)
  const totalSpent = gifts
    .filter((g) => g.status !== "planned")
    .reduce((sum, g) => sum + (g.price || 0), 0);
  // Count wrapped and given as complete (wrapped = ready to give)
  const completedCount = gifts.filter((g) => g.status === "wrapped" || g.status === "given").length;

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Gift Tracker", href: "/gift-tracker" },
          { label: recipient.name, href: `/gift-tracker/${recipientId}` },
        ]}
      />
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <User className="w-8 h-8 text-primary" />
          </div>
          <div>
            <Heading level="h1">{recipient.name}</Heading>
            {recipient.notes && (
              <Text variant="secondary" className="mt-1">
                {recipient.notes}
              </Text>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/gift-tracker/${recipientId}/edit`}>
            <Button variant="secondary" size="small">
              <Pencil className="w-4 h-4 mr-1" />
              Edit
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="p-4 rounded-lg bg-light-background border border-light-border">
          <Text variant="secondary" size="sm">Total Spent</Text>
          <Text className="text-2xl font-bold text-primary">
            ${totalSpent.toFixed(2)}
          </Text>
        </div>
        <div className="p-4 rounded-lg bg-light-background border border-light-border">
          <Text variant="secondary" size="sm">Total Gifts</Text>
          <Text className="text-2xl font-bold">{gifts.length}</Text>
        </div>
        <div className="p-4 rounded-lg bg-light-background border border-light-border">
          <Text variant="secondary" size="sm">Completed</Text>
          <Text className="text-2xl font-bold text-success">{completedCount}</Text>
        </div>
      </div>

      {/* Add Gift Button */}
      <div className="flex justify-end">
        <Link href={`/gift-tracker/${recipientId}/add-gift`}>
          <Button variant="primary">
            <Plus className="w-4 h-4 mr-2" />
            Add Gift
          </Button>
        </Link>
      </div>

      {/* Gifts List */}
      {gifts.length === 0 ? (
        <EmptyState type="gifts" recipientId={recipientId} />
      ) : (
        <div className="space-y-3">
          {gifts.map((gift) => (
            <GiftCard key={gift.id} gift={gift} />
          ))}
        </div>
      )}
    </div>
  );
}
