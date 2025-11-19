import Link from "next/link";
import { Gift, Users, DollarSign, CheckCircle2, Circle } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { formatCurrency } from "@/lib/utils/dates";

interface GroupGiftCardProps {
  groupGift: {
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

export function GroupGiftCard({ groupGift, memberCount = 0 }: GroupGiftCardProps) {
  const progress = groupGift.target_amount && groupGift.current_amount
    ? Math.min((groupGift.current_amount / groupGift.target_amount) * 100, 100)
    : 0;

  const isComplete = groupGift.target_amount && groupGift.current_amount
    ? groupGift.current_amount >= groupGift.target_amount
    : false;

  return (
    <Link href={`/gifts/${groupGift.id}`}>
      <div className="block p-5 rounded-lg border border-light-border hover:border-primary transition-colors bg-light-background">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 flex-1">
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center flex-shrink-0 ${
              isComplete
                ? "bg-success-light"
                : "bg-primary-50"
            }`}>
              <Gift className={`w-6 h-6 ${
                isComplete ? "text-success" : "text-primary"
              }`} />
            </div>
            <div className="flex-1 min-w-0">
              <Heading level="h4" className="truncate">{groupGift.name}</Heading>
              {groupGift.description && (
                <Text variant="secondary" size="sm" className="line-clamp-1 mt-0.5">
                  {groupGift.description}
                </Text>
              )}
            </div>
          </div>
          {!groupGift.is_active && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600 ml-2">
              Inactive
            </span>
          )}
        </div>

        {/* Progress Section */}
        {groupGift.target_amount !== null && (
          <div className="space-y-2 mb-4">
            <div className="flex items-center justify-between text-sm">
              <Text size="sm" className="font-medium">
                Progress
              </Text>
              <Text size="sm" className="font-medium">
                {formatCurrency(groupGift.current_amount || 0)} / {formatCurrency(groupGift.target_amount)}
              </Text>
            </div>
            <div className="w-full bg-light-background-hover rounded-full h-2">
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
        <div className="flex items-center gap-4 pt-3 border-t border-light-border">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-light-text-secondary" />
            <Text size="sm" variant="secondary">
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </Text>
          </div>

          {groupGift.my_contribution !== undefined && groupGift.my_contribution !== null && groupGift.my_contribution > 0 && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-light-text-secondary" />
              <Text size="sm" variant="secondary">
                Your pledge: {formatCurrency(groupGift.my_contribution)}
              </Text>
            </div>
          )}

          {groupGift.my_has_paid !== undefined && (
            <div className="flex items-center gap-1.5 ml-auto">
              {groupGift.my_has_paid ? (
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
