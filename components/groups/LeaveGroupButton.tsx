"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { leaveGroup } from "@/lib/actions/groups";

interface LeaveGroupButtonProps {
  groupId: string;
  groupName: string;
}

export function LeaveGroupButton({ groupId, groupName }: LeaveGroupButtonProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLeave = async () => {
    setIsLoading(true);
    setError(null);

    const result = await leaveGroup(groupId);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else {
      router.push("/groups");
      router.refresh();
    }
  };

  if (!showConfirm) {
    return (
      <Button
        variant="destructive"
        size="small"
        onClick={() => setShowConfirm(true)}
      >
        <LogOut className="w-4 h-4" />
        Leave Group
      </Button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={() => setShowConfirm(false)}
      />

      {/* Confirmation Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-light-background dark:bg-dark-background-secondary rounded-lg border border-light-border dark:border-dark-border max-w-md w-full p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-error-light dark:bg-error-dark flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-error" />
            </div>
            <div>
              <Heading level="h3">Leave Group?</Heading>
              <Text variant="secondary" size="sm" className="mt-1">
                Are you sure you want to leave <strong>{groupName}</strong>?
                You&apos;ll need a new invitation to rejoin.
              </Text>
            </div>
          </div>

          {error && (
            <div className="p-3 rounded bg-error-light dark:bg-error-dark border border-error">
              <Text variant="error" size="sm">
                {error}
              </Text>
            </div>
          )}

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => setShowConfirm(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleLeave}
              loading={isLoading}
              className="flex-1"
            >
              Leave Group
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
