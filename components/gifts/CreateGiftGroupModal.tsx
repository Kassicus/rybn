"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, X, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { createGiftGroup } from "@/lib/actions/gifts";

interface CreateGiftGroupModalProps {
  groupId: string;
  onClose: () => void;
}

export function CreateGiftGroupModal({
  groupId,
  onClose,
}: CreateGiftGroupModalProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    const parsedAmount = targetAmount ? parseFloat(targetAmount) : null;
    if (targetAmount && (isNaN(parsedAmount as number) || (parsedAmount as number) < 0)) {
      setError("Please enter a valid target amount");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await createGiftGroup({
      name: name.trim(),
      description: description.trim() || null,
      group_id: groupId,
      target_user_id: null,
      target_amount: parsedAmount,
      is_active: true,
    });

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      // Navigate to the new gift group
      router.push(`/gifts/${result.data.id}`);
      onClose();
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div className="bg-light-background rounded-lg border border-light-border max-w-md w-full p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary-50 flex items-center justify-center">
                <Gift className="w-5 h-5 text-primary" />
              </div>
              <div>
                <Heading level="h3">Create Gift Group</Heading>
                <Text variant="secondary" size="sm">
                  Coordinate a group gift
                </Text>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-text-secondary hover:text-text-primary"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {error && (
            <div className="p-3 rounded bg-error-light border border-error">
              <Text variant="error" size="sm">
                {error}
              </Text>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block mb-2">
                <Text size="sm" className="font-medium">
                  Gift Name <span className="text-error">*</span>
                </Text>
              </label>
              <Input
                type="text"
                placeholder="e.g., Birthday Gift for Sarah"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={200}
                required
              />
            </div>

            <div>
              <label className="block mb-2">
                <Text size="sm" className="font-medium">
                  Description
                </Text>
              </label>
              <textarea
                placeholder="What are you planning to get?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={1000}
                rows={3}
                className="w-full px-3 py-2 rounded-md border border-light-border bg-light-background text-light-text-primary placeholder:text-light-text-secondary focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>

            <div>
              <label className="block mb-2">
                <Text size="sm" className="font-medium">
                  Target Amount
                </Text>
              </label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-light-text-secondary" />
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={targetAmount}
                  onChange={(e) => setTargetAmount(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Text size="sm" variant="secondary" className="mt-1">
                Optional - Set a fundraising goal
              </Text>
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                className="flex-1"
                disabled={isLoading}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                loading={isLoading}
                className="flex-1"
              >
                <Gift className="w-4 h-4" />
                Create Gift Group
              </Button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
