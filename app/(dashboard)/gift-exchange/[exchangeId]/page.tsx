import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Gift, Calendar, MapPin, DollarSign, Users } from "lucide-react";
import { Heading, Text } from "@/components/ui/text";
import { Separator } from "@/components/ui/separator";
import { ParticipantList } from "@/components/gift-exchange/ParticipantList";
import { AssignmentReveal } from "@/components/gift-exchange/AssignmentReveal";
import { GiftExchangeActions } from "@/components/gift-exchange/GiftExchangeActions";
import { GiftExchangeSettings } from "@/components/gift-exchange/GiftExchangeSettings";
import { getGiftExchangeById, getMyAssignment } from "@/lib/actions/gift-exchange";
import { createClient } from "@/lib/supabase/server";
import { format } from "date-fns";

export default async function GiftExchangeDetailPage({
  params,
}: {
  params: Promise<{ exchangeId: string }>;
}) {
  const { exchangeId } = await params;
  const supabase = await createClient();

  const { data: exchange, error } = await getGiftExchangeById(exchangeId);
  const { data: assignedUser } = await getMyAssignment(exchangeId);

  if (error || !exchange) {
    notFound();
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    notFound();
  }

  const isCreator = exchange.created_by === user.id;
  const isParticipating = !!exchange.my_participation;

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
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/gift-exchange"
          className="inline-flex items-center gap-2 text-primary hover:underline mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <Text size="sm">Back to Gift Exchanges</Text>
        </Link>

        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-lg bg-primary-50 dark:bg-primary-900/20 flex items-center justify-center flex-shrink-0">
              <Gift className="w-8 h-8 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Heading level="h1">{exchange.name}</Heading>
                {!exchange.is_active && (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                    Inactive
                  </span>
                )}
              </div>
              {exchange.description && (
                <Text variant="secondary" className="mt-1">
                  {exchange.description}
                </Text>
              )}
              <div className="flex items-center gap-2 mt-2">
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary-light text-primary">
                  {typeLabel}
                </span>
                {exchange.assignments_generated && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-success-light dark:bg-success-dark text-success">
                    Assigned
                  </span>
                )}
                {isCreator && (
                  <span className="px-2 py-0.5 rounded text-xs font-medium bg-primary-100 dark:bg-primary-900/40 text-primary">
                    Creator
                  </span>
                )}
              </div>
            </div>
          </div>

          <GiftExchangeSettings
            exchangeId={exchange.id}
            exchangeName={exchange.name}
            isCreator={isCreator}
            isParticipating={isParticipating}
            assignmentsGenerated={exchange.assignments_generated}
          />
        </div>
      </div>

      {/* Event Details */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {exchange.exchange_date && (
          <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="w-4 h-4 text-primary" />
              <Text size="sm" variant="secondary">
                Exchange Date
              </Text>
            </div>
            <Heading level="h4">
              {format(new Date(exchange.exchange_date), "MMM d, yyyy")}
            </Heading>
            <Text size="sm" variant="secondary">
              {format(new Date(exchange.exchange_date), "h:mm a")}
            </Text>
          </div>
        )}

        {budget && (
          <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-4 h-4 text-primary" />
              <Text size="sm" variant="secondary">
                Budget Range
              </Text>
            </div>
            <Heading level="h4">{budget}</Heading>
          </div>
        )}

        <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-primary" />
            <Text size="sm" variant="secondary">
              Participants
            </Text>
          </div>
          <Heading level="h4">
            {exchange.participants?.filter((p) => p.opted_in).length || 0}
          </Heading>
          <Text size="sm" variant="secondary">
            {exchange.assignments_generated ? "Assignments complete" : "Registering"}
          </Text>
        </div>

        {exchange.exchange_location && (
          <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
            <div className="flex items-center gap-2 mb-2">
              <MapPin className="w-4 h-4 text-primary" />
              <Text size="sm" variant="secondary">
                Location
              </Text>
            </div>
            <Heading level="h4">{exchange.exchange_location}</Heading>
          </div>
        )}
      </div>

      {exchange.exchange_details && (
        <div className="p-4 rounded-lg border border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover">
          <Heading level="h4" className="mb-2">
            Additional Details
          </Heading>
          <Text className="whitespace-pre-wrap">{exchange.exchange_details}</Text>
        </div>
      )}

      <Separator />

      {/* Actions */}
      <GiftExchangeActions
        exchangeId={exchange.id}
        isCreator={isCreator}
        isParticipating={isParticipating}
        assignmentsGenerated={exchange.assignments_generated}
        participantCount={exchange.participants?.filter((p) => p.opted_in).length || 0}
        registrationDeadline={exchange.registration_deadline}
      />

      {/* Main Content - Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Left Column - Participants */}
        <div>
          <ParticipantList
            participants={exchange.participants || []}
            currentUserId={user.id}
            showAssignmentStatus={exchange.assignments_generated}
          />
        </div>

        {/* Right Column - Assignment (if participating and assigned) */}
        <div>
          {isParticipating && exchange.assignments_generated && (
            <AssignmentReveal assignedUser={assignedUser || null} budgetRange={budget || undefined} />
          )}

          {isParticipating && !exchange.assignments_generated && (
            <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
              <Gift className="w-12 h-12 text-light-text-secondary dark:text-dark-text-secondary mx-auto mb-3" />
              <Heading level="h4" className="mb-2">
                Waiting for Assignments
              </Heading>
              <Text variant="secondary">
                The exchange creator will generate assignments when everyone has joined.
              </Text>
            </div>
          )}

          {!isParticipating && (
            <div className="p-8 rounded-lg border border-light-border dark:border-dark-border border-dashed text-center">
              <Gift className="w-12 h-12 text-light-text-secondary dark:text-dark-text-secondary mx-auto mb-3" />
              <Heading level="h4" className="mb-2">
                Not Participating
              </Heading>
              <Text variant="secondary">
                Join this exchange to see your assignment and participate.
              </Text>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
