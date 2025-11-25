"use client";

import { Gift, UserPlus } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import Link from "next/link";

interface EmptyStateProps {
  type: "recipients" | "gifts";
  recipientId?: string;
}

export function EmptyState({ type, recipientId }: EmptyStateProps) {
  if (type === "recipients") {
    return (
      <div className="text-center py-16 px-4">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-primary/10 flex items-center justify-center">
          <UserPlus className="w-10 h-10 text-primary" />
        </div>
        <Heading level="h2" className="mb-2">
          Start Tracking Gifts
        </Heading>
        <Text variant="secondary" className="max-w-md mx-auto mb-6">
          Add the people you&apos;re buying gifts for this season. You can track
          gift ideas, status, and spending for each person.
        </Text>
        <Link href="/gift-tracker/add-recipient">
          <Button variant="primary" size="large">
            <UserPlus className="w-5 h-5 mr-2" />
            Add Your First Recipient
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="text-center py-12 px-4">
      <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-primary/10 flex items-center justify-center">
        <Gift className="w-8 h-8 text-primary" />
      </div>
      <Heading level="h3" className="mb-2">
        No Gifts Yet
      </Heading>
      <Text variant="secondary" className="max-w-sm mx-auto mb-4">
        Start adding gift ideas for this person. Track what you&apos;re planning,
        ordered, and wrapped.
      </Text>
      {recipientId && (
        <Link href={`/gift-tracker/${recipientId}/add-gift`}>
          <Button variant="primary">
            <Gift className="w-4 h-4 mr-2" />
            Add First Gift
          </Button>
        </Link>
      )}
    </div>
  );
}
