import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGiftById, getMyRecipients } from "@/lib/actions/gift-tracking";
import { Heading, Text } from "@/components/ui/text";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { GiftForm } from "@/components/gift-tracking";
import type { GiftStatus } from "@/lib/schemas/gift-tracking";

interface PageProps {
  params: Promise<{
    recipientId: string;
    giftId: string;
  }>;
}

export default async function GiftDetailPage({ params }: PageProps) {
  const { recipientId, giftId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [giftResult, recipientsResult] = await Promise.all([
    getGiftById(giftId),
    getMyRecipients(),
  ]);

  if (giftResult.error || !giftResult.data) {
    notFound();
  }

  const gift = giftResult.data as {
    id: string;
    recipient_id: string;
    name: string;
    description: string | null;
    photo_url: string | null;
    product_link: string | null;
    price: number | null;
    status: GiftStatus;
    occasion: string | null;
    season_year: number;
    notes: string | null;
    gift_recipients?: {
      id: string;
      name: string;
    } | null;
  };
  const recipients = recipientsResult.data || [];
  const recipientName = gift.gift_recipients?.name || "Unknown";

  return (
    <div className="max-w-2xl mx-auto p-6">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Gift Tracker", href: "/gift-tracker" },
          { label: recipientName, href: `/gift-tracker/${recipientId}` },
          { label: gift.name, href: `/gift-tracker/${recipientId}/${giftId}` },
        ]}
      />
      <div className="mb-6">
        <Heading level="h1">Edit Gift</Heading>
        <Text variant="secondary">
          Update gift details for {recipientName}
        </Text>
      </div>

      <div className="bg-white rounded-lg border border-light-border p-6">
        <GiftForm
          recipients={recipients}
          defaultRecipientId={recipientId}
          gift={gift}
        />
      </div>
    </div>
  );
}
