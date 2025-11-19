"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Heading, Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { deleteGroup } from "@/lib/actions/groups";

interface DeleteGroupButtonProps {
  groupId: string;
  groupName: string;
}

export function DeleteGroupButton({
  groupId,
  groupName,
}: DeleteGroupButtonProps) {
  const router = useRouter();
  const [showConfirm, setShowConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    if (confirmText !== groupName) {
      setError("Group name does not match");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await deleteGroup(groupId);

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
        <Trash2 className="w-4 h-4" />
        Delete Group
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
        <div className="bg-light-background rounded-lg border border-light-border max-w-md w-full p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-error-light flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="w-5 h-5 text-error" />
            </div>
            <div>
              <Heading level="h3">Delete Group?</Heading>
              <Text variant="secondary" size="sm" className="mt-1">
                This action cannot be undone. This will permanently delete{" "}
                <strong>{groupName}</strong> and remove all members.
              </Text>
            </div>
          </div>

          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Type the group name to confirm:
              </Text>
            </label>
            <Input
              type="text"
              placeholder={groupName}
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              error={error || undefined}
            />
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              onClick={() => {
                setShowConfirm(false);
                setConfirmText("");
                setError(null);
              }}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              loading={isLoading}
              disabled={confirmText !== groupName}
              className="flex-1"
            >
              Delete Permanently
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
