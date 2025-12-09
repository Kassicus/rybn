"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, User } from "lucide-react";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { GiftCard } from "./GiftCard";
import { STATUS_INFO, type GiftStatus } from "@/lib/schemas/gift-tracking";

interface TrackedGift {
  id: string;
  recipient_id: string;
  name: string;
  description: string | null;
  photo_url: string | null;
  product_link: string | null;
  price: number | null;
  status: GiftStatus;
  occasion: string | null;
}

interface RecipientWithStats {
  id: string;
  name: string;
  notes: string | null;
  giftCount: number;
  totalSpent: number;
  completedCount: number;
}

interface RecipientCardProps {
  recipient: RecipientWithStats;
  gifts?: TrackedGift[];
  defaultExpanded?: boolean;
  onGiftChange?: () => void;
}

/**
 * Calculate progress percentage based on gift statuses
 * Each status represents: planned=20%, ordered=40%, arrived=60%, wrapped=80%, given=100%
 */
function calculateProgressFromGifts(gifts: TrackedGift[]): {
  progressPercent: number;
  statusCounts: Record<GiftStatus, number>;
} {
  const statusCounts: Record<GiftStatus, number> = {
    planned: 0,
    ordered: 0,
    arrived: 0,
    wrapped: 0,
    given: 0,
  };

  if (gifts.length === 0) {
    return { progressPercent: 0, statusCounts };
  }

  let totalProgress = 0;
  for (const gift of gifts) {
    statusCounts[gift.status]++;
    // Each step is worth 20% (step 1-5 maps to 20%-100%)
    const stepProgress = (STATUS_INFO[gift.status].step / 5) * 100;
    totalProgress += stepProgress;
  }

  return {
    progressPercent: Math.round(totalProgress / gifts.length),
    statusCounts,
  };
}

export function RecipientCard({
  recipient,
  gifts = [],
  defaultExpanded = false,
  onGiftChange,
}: RecipientCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const { progressPercent, statusCounts } = calculateProgressFromGifts(gifts);
  const isComplete = progressPercent === 100;

  return (
    <div className="border border-light-border rounded-lg bg-white overflow-hidden">
      {/* Header - clickable to expand */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center gap-4 hover:bg-light-background-hover transition-colors text-left"
      >
        {/* Avatar */}
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <User className="w-6 h-6 text-primary" />
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Text className="font-semibold text-lg truncate">{recipient.name}</Text>
            <span className="px-2 py-0.5 rounded-full text-xs bg-light-background-hover">
              {recipient.giftCount} {recipient.giftCount === 1 ? "gift" : "gifts"}
            </span>
          </div>

          <div className="flex items-center gap-4 mt-1">
            {/* Total spent */}
            <Text size="sm" variant="secondary">
              ${recipient.totalSpent.toFixed(2)} spent
            </Text>

            {/* Progress */}
            {gifts.length > 0 && (
              <div className="flex items-center gap-2">
                {/* Segmented progress bar showing status breakdown */}
                <div className="w-28 h-2 bg-gray-200 rounded-full overflow-hidden flex">
                  {/* Stack segments in order: given, wrapped, arrived, ordered, planned */}
                  {statusCounts.given > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(statusCounts.given / gifts.length) * 100}%`,
                        backgroundColor: STATUS_INFO.given.hexColor,
                      }}
                    />
                  )}
                  {statusCounts.wrapped > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(statusCounts.wrapped / gifts.length) * 100}%`,
                        backgroundColor: STATUS_INFO.wrapped.hexColor,
                      }}
                    />
                  )}
                  {statusCounts.arrived > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(statusCounts.arrived / gifts.length) * 100}%`,
                        backgroundColor: STATUS_INFO.arrived.hexColor,
                      }}
                    />
                  )}
                  {statusCounts.ordered > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(statusCounts.ordered / gifts.length) * 100}%`,
                        backgroundColor: STATUS_INFO.ordered.hexColor,
                      }}
                    />
                  )}
                  {statusCounts.planned > 0 && (
                    <div
                      className="h-full"
                      style={{
                        width: `${(statusCounts.planned / gifts.length) * 100}%`,
                        backgroundColor: STATUS_INFO.planned.hexColor,
                      }}
                    />
                  )}
                </div>
                {/* Progress percentage or completion indicator */}
                <Text size="sm" variant="secondary" className="min-w-[3ch]">
                  {isComplete ? (
                    <span className="text-success">✓</span>
                  ) : (
                    `${progressPercent}%`
                  )}
                </Text>
              </div>
            )}
          </div>
        </div>

        {/* Expand icon */}
        {isExpanded ? (
          <ChevronDown className="w-5 h-5 text-gray-400" />
        ) : (
          <ChevronRight className="w-5 h-5 text-gray-400" />
        )}
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-light-border">
          {/* Action bar */}
          <div className="px-4 py-2 bg-light-background-hover flex items-center justify-between">
            <Link href={`/gift-tracker/${recipient.id}`}>
              <Text
                size="sm"
                className="text-primary hover:underline cursor-pointer"
              >
                View all & manage
              </Text>
            </Link>
            <Link href={`/gift-tracker/${recipient.id}/add-gift`}>
              <Button variant="secondary" size="small">
                <Plus className="w-4 h-4 mr-1" />
                Add Gift
              </Button>
            </Link>
          </div>

          {/* Gifts list */}
          <div className="p-4 space-y-3">
            {gifts.length === 0 ? (
              <div className="text-center py-8">
                <Text variant="secondary">No gifts yet</Text>
                <Link href={`/gift-tracker/${recipient.id}/add-gift`}>
                  <Button variant="primary" size="small" className="mt-2">
                    <Plus className="w-4 h-4 mr-1" />
                    Add First Gift
                  </Button>
                </Link>
              </div>
            ) : (
              gifts.map((gift) => (
                <GiftCard
                  key={gift.id}
                  gift={gift}
                  onStatusChange={onGiftChange}
                  onDelete={onGiftChange}
                />
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
