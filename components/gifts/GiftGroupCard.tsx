import Link from "next/link";
import { Gift, Users, DollarSign, CheckCircle2, Circle } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { formatCurrency } from "@/lib/utils/dates";

interface GiftGroupCardProps {
  giftGroup: {
    id: string;
    name: string;
    description: string | null;
    target_amount: number | null;
    current_amount: number | null;
    is_active: boolean | null;
    created_at: string | null;
    my_contribution?: number | null;
    my_has_paid?: boolean | null;
  };
  memberCount?: number;
}

export function GiftGroupCard({ giftGroup, memberCount = 0 }: GiftGroupCardProps) {
  const progress = giftGroup.target_amount && giftGroup.current_amount
    ? Math.min((giftGroup.current_amount / giftGroup.target_amount) * 100, 100)
    : 0;

  const isComplete = giftGroup.target_amount && giftGroup.current_amount
    ? giftGroup.current_amount >= giftGroup.target_amount
    : false;

  return (
    <Link href={`/gifts/${giftGroup.id}`}>
      <div className="block p-5 rounded-lg border border-light-border dark:border-dark-border hover:border-primary dark:hover:border-primary transition-colors bg-light-background dark:bg-dark-background-secondary">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isComplete
                ? "bg-success-light dark:bg-success/20"
                : "bg-primary-50 dark:bg-primary-900/20"
            }`}>
              <Gift className={`w-6 h-6 ${
                isComplete ? "text-success" : "text-primary"
              }`} />
            </div>
            <div className="flex-1 min-w-0">
              <Heading level="h4" className="truncate">{giftGroup.name}</Heading>
              {giftGroup.description && (
                <Text variant="secondary" size="sm" className="line-clamp-1 mt-0.5">
                  {giftGroup.description}
                </Text>
              )}
            </div>
          </div>
          {!giftGroup.is_active && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 ml-2">
              Inactive
            </span>
          )}
        </div>

        {/* Progress Section */}
        {giftGroup.target_amount !== null && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between text-sm">
              <Text size="sm" className="font-medium">
                Progress
              </Text>
              <Text size="sm" className="font-medium">
                {formatCurrency(giftGroup.current_amount || 0)} / {formatCurrency(giftGroup.target_amount)}
              </Text>
            </div>
            <div className="w-full bg-light-background-hover dark:bg-dark-background-hover rounded-full h-2">
              <div
                className={`h-2 rounded-full transition-all ${
                  isComplete ? "bg-success" : "bg-primary"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 pt-3 border-t border-light-border dark:border-dark-border">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
            <Text size="sm" variant="secondary">
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </Text>
          </div>

          {giftGroup.my_contribution !== undefined && giftGroup.my_contribution > 0 && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
              <Text size="sm" variant="secondary">
                Your pledge: {formatCurrency(giftGroup.my_contribution)}
              </Text>
            </div>
          )}

          {giftGroup.my_has_paid !== undefined && (
            <div className="flex items-center gap-1.5 ml-auto">
              {giftGroup.my_has_paid ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-success" />
                  <Text size="sm" className="text-success">
                    Paid
                  </Text>
                </>
              ) : (
                <>
                  <Circle className="w-4 h-4 text-warning" />
                  <Text size="sm" className="text-warning">
                    Pending
                  </Text>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
