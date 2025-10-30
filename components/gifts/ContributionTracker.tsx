"use client";

import { useState } from "react";
import { DollarSign, Check, X, Edit2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { updateMyContribution } from "@/lib/actions/gifts";
import { formatCurrency } from "@/lib/utils/dates";

interface Member {
  id: string;
  user_id: string;
  contribution_amount: number | null;
  has_paid: boolean | null;
  user_profiles: {
    id: string;
    username: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface ContributionTrackerProps {
  groupGiftId: string;
  members: Member[];
  targetAmount: number | null;
  currentAmount: number | null;
  currentUserId: string;
  myMembership: {
    contribution_amount: number | null;
    has_paid: boolean | null;
  };
}

export function ContributionTracker({
  groupGiftId,
  members,
  targetAmount,
  currentAmount,
  currentUserId,
  myMembership,
}: ContributionTrackerProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [amount, setAmount] = useState(myMembership.contribution_amount?.toString() || "");
  const [hasPaid, setHasPaid] = useState(myMembership.has_paid || false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const progress = targetAmount && currentAmount
    ? Math.min((currentAmount / targetAmount) * 100, 100)
    : 0;

  const isComplete = targetAmount && currentAmount
    ? currentAmount >= targetAmount
    : false;

  const handleSave = async () => {
    const contributionAmount = parseFloat(amount);

    if (isNaN(contributionAmount) || contributionAmount < 0) {
      setError("Please enter a valid amount");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await updateMyContribution(groupGiftId, {
      contribution_amount: contributionAmount,
      has_paid: hasPaid,
    });

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else {
      setIsEditing(false);
      setIsLoading(false);
    }
  };

  const handleCancel = () => {
    setAmount(myMembership.contribution_amount?.toString() || "");
    setHasPaid(myMembership.has_paid || false);
    setError(null);
    setIsEditing(false);
  };

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      {targetAmount !== null && (
        <div className="p-5 rounded-lg border border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover">
          <div className="flex items-center justify-between mb-3">
            <Heading level="h4">Progress</Heading>
            <Text className="text-2xl font-bold">
              {formatCurrency(currentAmount || 0)}
            </Text>
          </div>

          <div className="space-y-2">
            <div className="w-full bg-light-background dark:bg-dark-background-secondary rounded-full h-3">
              <div
                className={`h-3 rounded-full transition-all ${
                  isComplete ? "bg-success" : "bg-primary"
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between">
              <Text size="sm" variant="secondary">
                of {formatCurrency(targetAmount)} goal
              </Text>
              <Text size="sm" variant="secondary">
                {progress.toFixed(0)}%
              </Text>
            </div>
          </div>
        </div>
      )}

      {/* Your Contribution */}
      <div className="p-5 rounded-lg border border-light-border dark:border-dark-border">
        <div className="flex items-center justify-between mb-4">
          <Heading level="h4">Your Contribution</Heading>
          {!isEditing && (
            <Button
              variant="tertiary"
              size="small"
              onClick={() => setIsEditing(true)}
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </Button>
          )}
        </div>

        {isEditing ? (
          <div className="space-y-4">
            {error && (
              <div className="p-3 rounded bg-error-light dark:bg-error-dark border border-error">
                <Text variant="error" size="sm">
                  {error}
                </Text>
              </div>
            )}

            <div>
              <label className="block mb-2">
                <Text size="sm" className="font-medium">
                  Your Pledge Amount
                </Text>
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-light-text-secondary dark:text-dark-text-secondary" />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="hasPaid"
                checked={hasPaid}
                onChange={(e) => setHasPaid(e.target.checked)}
                className="w-4 h-4 text-primary bg-light-background border-light-border rounded focus:ring-primary focus:ring-2"
              />
              <label htmlFor="hasPaid">
                <Text size="sm">I have paid this amount</Text>
              </label>
            </div>

            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={handleCancel}
                className="flex-1"
                disabled={isLoading}
              >
                <X className="w-4 h-4" />
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleSave}
                className="flex-1"
                loading={isLoading}
              >
                <Check className="w-4 h-4" />
                Save
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between p-3 rounded bg-light-background-hover dark:bg-dark-background-hover">
              <Text size="sm" variant="secondary">
                Your Pledge
              </Text>
              <Text className="font-semibold">
                {formatCurrency(myMembership.contribution_amount || 0)}
              </Text>
            </div>
            <div className="flex items-center justify-between p-3 rounded bg-light-background-hover dark:bg-dark-background-hover">
              <Text size="sm" variant="secondary">
                Payment Status
              </Text>
              <span className={`px-2 py-1 rounded text-xs font-medium ${
                myMembership.has_paid
                  ? "bg-success-light dark:bg-success-dark text-success"
                  : "bg-warning-light dark:bg-warning-dark text-warning"
              }`}>
                {myMembership.has_paid ? "Paid" : "Pending"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* All Members */}
      <div className="space-y-3">
        <Heading level="h4">All Members</Heading>
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-4 rounded-lg border border-light-border dark:border-dark-border"
            >
              <div className="flex items-center gap-3">
                <Avatar>
                  {member.user_profiles?.avatar_url && (
                    <AvatarImage src={member.user_profiles.avatar_url} />
                  )}
                  <AvatarFallback>
                    {(
                      member.user_profiles?.display_name ||
                      member.user_profiles?.username ||
                      "?"
                    )
                      .charAt(0)
                      .toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <Text className="font-medium">
                    {member.user_profiles?.display_name ||
                      member.user_profiles?.username ||
                      "Unknown User"}
                    {member.user_id === currentUserId && (
                      <span className="text-primary ml-1">(You)</span>
                    )}
                  </Text>
                  {member.user_profiles?.username && member.user_profiles?.display_name && (
                    <Text variant="secondary" size="sm">
                      @{member.user_profiles.username}
                    </Text>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4">
                <Text className="font-semibold">
                  {formatCurrency(member.contribution_amount || 0)}
                </Text>
                {member.has_paid ? (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-success-light dark:bg-success-dark text-success">
                    Paid
                  </span>
                ) : (
                  <span className="px-2 py-1 rounded text-xs font-medium bg-warning-light dark:bg-warning-dark text-warning">
                    Pending
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
