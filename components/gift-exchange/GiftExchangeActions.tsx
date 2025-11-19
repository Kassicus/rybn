"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { UserPlus, Shuffle, AlertTriangle } from "lucide-react";
import {
  joinGiftExchange,
  generateGiftExchangeAssignments,
} from "@/lib/actions/gift-exchange";

interface GiftExchangeActionsProps {
  exchangeId: string;
  isCreator: boolean;
  isParticipating: boolean;
  assignmentsGenerated: boolean;
  participantCount: number;
  registrationDeadline: string | null;
}

export function GiftExchangeActions({
  exchangeId,
  isCreator,
  isParticipating,
  assignmentsGenerated,
  participantCount,
  registrationDeadline,
}: GiftExchangeActionsProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirmGenerate, setShowConfirmGenerate] = useState(false);

  const canJoin =
    !isParticipating &&
    !assignmentsGenerated &&
    (!registrationDeadline || new Date(registrationDeadline) > new Date());

  const canGenerateAssignments =
    isCreator && !assignmentsGenerated && participantCount >= 3;

  const handleJoin = async () => {
    setIsLoading(true);
    setError(null);

    const result = await joinGiftExchange(exchangeId);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else {
      router.refresh();
    }
  };

  const handleGenerateAssignments = async () => {
    setIsLoading(true);
    setError(null);

    const result = await generateGiftExchangeAssignments(exchangeId);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
      setShowConfirmGenerate(false);
    } else {
      setShowConfirmGenerate(false);
      router.refresh();
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="p-4 rounded-lg bg-error-light border border-error">
          <Text variant="error">{error}</Text>
        </div>
      )}

      <div className="flex gap-3">
        {canJoin && (
          <Button
            variant="primary"
            onClick={handleJoin}
            loading={isLoading}
            className="flex-1"
          >
            <UserPlus className="w-4 h-4" />
            Join Exchange
          </Button>
        )}

        {canGenerateAssignments && !showConfirmGenerate && (
          <Button
            variant="primary"
            onClick={() => setShowConfirmGenerate(true)}
            disabled={isLoading}
            className="flex-1"
          >
            <Shuffle className="w-4 h-4" />
            Generate Assignments
          </Button>
        )}
      </div>

      {canGenerateAssignments && showConfirmGenerate && (
        <div className="p-6 rounded-lg border-2 border-warning bg-warning-light">
          <div className="flex gap-3 mb-4">
            <AlertTriangle className="w-6 h-6 text-warning flex-shrink-0" />
            <div className="flex-1">
              <Text className="font-semibold text-warning mb-2">
                Generate Assignments?
              </Text>
              <Text size="sm" variant="secondary">
                This will randomly assign each participant to give a gift to another
                participant. Once generated, assignments cannot be changed and no one
                else can join.
              </Text>
              <Text size="sm" variant="secondary" className="mt-2">
                Current participants: <strong>{participantCount}</strong>
              </Text>
            </div>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowConfirmGenerate(false)}
              disabled={isLoading}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleGenerateAssignments}
              loading={isLoading}
              className="flex-1"
            >
              Confirm & Generate
            </Button>
          </div>
        </div>
      )}

      {participantCount < 3 && isCreator && !assignmentsGenerated && (
        <div className="p-4 rounded-lg bg-light-background-hover border border-light-border">
          <Text size="sm" variant="secondary">
            ℹ️ You need at least 3 participants before you can generate assignments.
            Current: {participantCount}
          </Text>
        </div>
      )}

      {registrationDeadline && new Date(registrationDeadline) < new Date() && !assignmentsGenerated && (
        <div className="p-4 rounded-lg bg-warning-light border border-warning">
          <Text size="sm" className="text-warning">
            ⚠️ Registration deadline has passed. No new participants can join.
          </Text>
        </div>
      )}
    </div>
  );
}
