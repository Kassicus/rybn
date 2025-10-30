"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Trash2, UserMinus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { deleteGiftExchange, leaveGiftExchange } from "@/lib/actions/gift-exchange";

interface GiftExchangeSettingsProps {
  exchangeId: string;
  exchangeName: string;
  isCreator: boolean;
  isParticipating: boolean;
  assignmentsGenerated: boolean;
}

export function GiftExchangeSettings({
  exchangeId,
  exchangeName,
  isCreator,
  isParticipating,
  assignmentsGenerated,
}: GiftExchangeSettingsProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canLeave = isParticipating && !assignmentsGenerated;

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    const result = await deleteGiftExchange(exchangeId);

    if (result.error) {
      setError(result.error);
      setIsDeleting(false);
    } else {
      // Redirect to gift exchange list after successful deletion
      router.push("/gift-exchange");
      router.refresh();
    }
  };

  const handleLeave = async () => {
    setIsLeaving(true);
    setError(null);

    const result = await leaveGiftExchange(exchangeId);

    if (result.error) {
      setError(result.error);
      setIsLeaving(false);
    } else {
      // Close modal and refresh
      setShowModal(false);
      setShowLeaveConfirm(false);
      router.refresh();
    }
  };

  return (
    <>
      <Button variant="secondary" size="small" onClick={() => setShowModal(true)}>
        <Settings className="w-4 h-4" />
        Settings
      </Button>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background p-6 shadow-xl">
            <div className="flex items-center justify-between mb-6">
              <Heading level="h3">Exchange Settings</Heading>
              <button
                onClick={() => {
                  setShowModal(false);
                  setShowDeleteConfirm(false);
                  setShowLeaveConfirm(false);
                  setError(null);
                }}
                className="p-1 rounded hover:bg-light-background-hover dark:hover:bg-dark-background-hover"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="p-4 rounded-lg bg-error-light dark:bg-error-dark border border-error mb-4">
                <Text variant="error">{error}</Text>
              </div>
            )}

            {!showDeleteConfirm && !showLeaveConfirm && (
              <div className="space-y-3">
                {canLeave && (
                  <div className="p-4 rounded-lg border border-light-border dark:border-dark-border hover:bg-light-background-hover dark:hover:bg-dark-background-hover">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <UserMinus className="w-4 h-4 text-warning" />
                          <Text className="font-medium">Leave Exchange</Text>
                        </div>
                        <Text size="sm" variant="secondary">
                          Remove yourself from this exchange. You can rejoin later if
                          assignments haven't been generated yet.
                        </Text>
                      </div>
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={() => setShowLeaveConfirm(true)}
                      >
                        Leave
                      </Button>
                    </div>
                  </div>
                )}

                {isCreator && (
                  <div className="p-4 rounded-lg border border-error bg-error-light dark:bg-error-dark">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Trash2 className="w-4 h-4 text-error" />
                          <Text className="font-medium text-error">Delete Exchange</Text>
                        </div>
                        <Text size="sm" variant="secondary">
                          Permanently delete this gift exchange and all its data. This cannot
                          be undone.
                        </Text>
                      </div>
                      <Button
                        variant="destructive"
                        size="small"
                        onClick={() => setShowDeleteConfirm(true)}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                )}

                {!isCreator && !canLeave && (
                  <div className="p-4 rounded-lg border border-light-border dark:border-dark-border bg-light-background-hover dark:bg-dark-background-hover text-center">
                    <Text size="sm" variant="secondary">
                      No settings available. You cannot leave after assignments have been
                      generated.
                    </Text>
                  </div>
                )}
              </div>
            )}

            {showLeaveConfirm && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-warning-light dark:bg-warning-dark border border-warning">
                  <Text className="font-medium mb-2">
                    Leave "{exchangeName}"?
                  </Text>
                  <Text size="sm" variant="secondary">
                    Are you sure you want to leave this gift exchange? You can rejoin later
                    if assignments haven't been generated yet.
                  </Text>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setShowLeaveConfirm(false)}
                    disabled={isLeaving}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleLeave}
                    loading={isLeaving}
                    className="flex-1"
                  >
                    Leave Exchange
                  </Button>
                </div>
              </div>
            )}

            {showDeleteConfirm && (
              <div className="space-y-4">
                <div className="p-4 rounded-lg bg-error-light dark:bg-error-dark border border-error">
                  <Text className="font-medium mb-2 text-error">
                    Delete "{exchangeName}"?
                  </Text>
                  <Text size="sm" variant="secondary">
                    This will permanently delete this gift exchange and all its data,
                    including all participants and assignments. This action cannot be undone.
                  </Text>
                </div>

                <div className="flex gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    loading={isDeleting}
                    className="flex-1"
                  >
                    Delete Forever
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
