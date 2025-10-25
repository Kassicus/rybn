"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { deleteGroupGift } from "@/lib/actions/gifts";

interface GroupGiftSettingsProps {
  groupGiftId: string;
  groupGiftName: string;
  isCreator: boolean;
}

export function GroupGiftSettings({
  groupGiftId,
  groupGiftName,
  isCreator,
}: GroupGiftSettingsProps) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isCreator) {
    return null;
  }

  const handleDelete = async () => {
    setIsDeleting(true);
    setError(null);

    const result = await deleteGroupGift(groupGiftId);

    if (result.error) {
      setError(result.error);
      setIsDeleting(false);
    } else {
      // Redirect to gifts list after successful deletion
      router.push("/gifts");
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
              <Heading level="h3">Group Gift Settings</Heading>
              <button
                onClick={() => {
                  setShowModal(false);
                  setShowDeleteConfirm(false);
                  setError(null);
                }}
                className="p-1 hover:bg-light-background-hover dark:hover:bg-dark-background-hover rounded"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {error && (
              <div className="mb-4 p-3 rounded bg-error-light border border-error">
                <Text variant="error" size="sm">
                  {error}
                </Text>
              </div>
            )}

            {!showDeleteConfirm ? (
              <div className="space-y-4">
                <div className="p-4 rounded-lg border border-light-border dark:border-dark-border">
                  <Heading level="h4" className="mb-2">
                    Danger Zone
                  </Heading>
                  <Text size="sm" variant="secondary" className="mb-3">
                    Deleting this group gift is permanent and cannot be undone.
                  </Text>
                  <Button
                    variant="destructive"
                    onClick={() => setShowDeleteConfirm(true)}
                    disabled={isDeleting}
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete Group Gift
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="p-4 rounded-lg border-2 border-error bg-error-light">
                  <Heading level="h4" className="mb-2 text-error-dark">
                    Are you absolutely sure?
                  </Heading>
                  <Text size="sm" className="text-error-dark mb-2">
                    This will permanently delete <strong>{groupGiftName}</strong> and
                    remove all members and contributions.
                  </Text>
                  <Text size="sm" className="text-error-dark">
                    This action cannot be undone.
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
                    <Trash2 className="w-4 h-4" />
                    Yes, Delete Forever
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
