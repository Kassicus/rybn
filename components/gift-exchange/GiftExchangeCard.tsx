import Link from "next/link";
import { Gift, Users, Calendar, DollarSign } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { formatDistanceToNow } from "date-fns";

interface GiftExchangeCardProps {
  exchange: {
    id: string;
    name: string;
    description: string | null;
    exchange_type: string;
    budget_min: number | null;
    budget_max: number | null;
    exchange_date: string | null;
    is_active: boolean;
    assignments_generated: boolean;
    created_at: string;
  };
  participantCount?: number;
  isParticipating?: boolean;
}

export function GiftExchangeCard({
  exchange,
  participantCount = 0,
  isParticipating = false,
}: GiftExchangeCardProps) {
  const exchangeTypeLabels: Record<string, string> = {
    secret_santa: "Secret Santa",
    white_elephant: "White Elephant",
    yankee_swap: "Yankee Swap",
    custom: "Custom Exchange",
  };

  const typeLabel = exchangeTypeLabels[exchange.exchange_type] || "Gift Exchange";

  const formatBudget = () => {
    if (exchange.budget_min && exchange.budget_max) {
      return `$${exchange.budget_min} - $${exchange.budget_max}`;
    }
    if (exchange.budget_max) {
      return `Up to $${exchange.budget_max}`;
    }
    if (exchange.budget_min) {
      return `From $${exchange.budget_min}`;
    }
    return null;
  };

  const budget = formatBudget();

  return (
    <Link href={`/gift-exchange/${exchange.id}`}>
      <div className="block p-5 rounded-lg border border-light-border dark:border-dark-border hover:border-primary dark:hover:border-primary transition-colors bg-light-background dark:bg-dark-background-secondary">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3 flex-1">
            <div className="w-12 h-12 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
              <Gift className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <Heading level="h4" className="truncate">{exchange.name}</Heading>
              {exchange.description && (
                <Text variant="secondary" size="sm" className="line-clamp-1 mt-0.5">
                  {exchange.description}
                </Text>
              )}
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary-light text-primary">
                  {typeLabel}
                </span>
                {exchange.assignments_generated && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-success-light text-success">
                    Assigned
                  </span>
                )}
              </div>
            </div>
          </div>
          {!exchange.is_active && (
            <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 ml-2">
              Inactive
            </span>
          )}
        </div>

        {/* Stats */}
        <div className="flex items-center gap-4 pt-3 border-t border-light-border dark:border-dark-border">
          <div className="flex items-center gap-1.5">
            <Users className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
            <Text size="sm" variant="secondary">
              {participantCount} {participantCount === 1 ? "participant" : "participants"}
            </Text>
          </div>

          {budget && (
            <div className="flex items-center gap-1.5">
              <DollarSign className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
              <Text size="sm" variant="secondary">
                {budget}
              </Text>
            </div>
          )}

          {exchange.exchange_date && (
            <div className="flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-light-text-secondary dark:text-dark-text-secondary" />
              <Text size="sm" variant="secondary">
                {formatDistanceToNow(new Date(exchange.exchange_date), { addSuffix: true })}
              </Text>
            </div>
          )}

          {isParticipating && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="px-2 py-1 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary">
                Joined
              </span>
            </div>
          )}
        </div>
      </div>
    </Link>
  );
}
