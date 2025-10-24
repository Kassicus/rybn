import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Gift, Settings } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ContributionTracker } from "@/components/gifts/ContributionTracker";
import { ChatWindow } from "@/components/gifts/ChatWindow";
import { getGiftGroupById } from "@/lib/actions/gifts";
import { getMessages } from "@/lib/actions/messages";
import { createClient } from "@/lib/supabase/server";

export default async function GiftGroupDetailPage({
  params,
}: {
  params: Promise<{ giftGroupId: string }>;
}) {
  const { giftGroupId } = await params;
  const supabase = await createClient();

  const { data: giftGroup, error } = await getGiftGroupById(giftGroupId);
  const { data: messages = [] } = await getMessages(giftGroupId);

  if (error || !giftGroup) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const isCreator = giftGroup.created_by === user.id;

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/gifts"
          className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <Text size="sm">Back to Gift Groups</Text>
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
              <Gift className="w-8 h-8 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Heading level="h1">{giftGroup.name}</Heading>
                {!giftGroup.is_active && (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    Inactive
                  </span>
                )}
              </div>
              {giftGroup.description && (
                <Text variant="secondary" className="mt-1">
                  {giftGroup.description}
                </Text>
              )}
              <div className="flex items-center gap-2 mt-2">
                <Text size="sm" variant="secondary">
                  {giftGroup.gift_group_members?.length || 0}{" "}
                  {giftGroup.gift_group_members?.length === 1 ? "member" : "members"}
                </Text>
                {isCreator && (
                  <>
                    <span className="text-light-text-secondary dark:text-dark-text-secondary">•</span>
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary">
                      Creator
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {isCreator && (
            <Button variant="secondary" size="small">
              <Settings className="w-4 h-4" />
              Settings
            </Button>
          )}
        </div>
      </div>

      <Separator />

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Contribution Tracker */}
        <div>
          <ContributionTracker
            giftGroupId={giftGroup.id}
            members={giftGroup.gift_group_members || []}
            targetAmount={giftGroup.target_amount}
            currentAmount={giftGroup.current_amount}
            currentUserId={user.id}
            myMembership={giftGroup.my_membership}
          />
        </div>

        {/* Right Column - Chat */}
        <div>
          <ChatWindow
            giftGroupId={giftGroup.id}
            initialMessages={messages}
            currentUserId={user.id}
          />
        </div>
      </div>
    </div>
  );
}
