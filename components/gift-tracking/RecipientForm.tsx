"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { createRecipient, updateRecipient } from "@/lib/actions/gift-tracking";
import type { RecipientFormData } from "@/lib/schemas/gift-tracking";

interface RecipientFormProps {
  recipient?: {
    id: string;
    name: string;
    notes: string | null;
  };
  onSuccess?: (recipient: { id: string }) => void;
}

export function RecipientForm({ recipient, onSuccess }: RecipientFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = !!recipient;

  const [formData, setFormData] = useState<RecipientFormData>({
    name: recipient?.name || "",
    notes: recipient?.notes || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = isEditing
      ? await updateRecipient(recipient.id, formData)
      : await createRecipient(formData);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      if (onSuccess) {
        onSuccess(result.data);
      } else {
        router.push(`/gift-tracker/${result.data.id}`);
      }
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 rounded-lg bg-error-light border border-error">
          <Text variant="error">{error}</Text>
        </div>
      )}

      <div>
        <label className="block mb-2">
          <Text size="sm" className="font-medium">
            Name *
          </Text>
        </label>
        <Input
          type="text"
          placeholder="e.g., Mom, John, Sister"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
        <Text size="sm" variant="secondary" className="mt-1">
          The name of the person you&apos;re buying gifts for
        </Text>
      </div>

      <div>
        <label className="block mb-2">
          <Text size="sm" className="font-medium">
            Notes
          </Text>
        </label>
        <textarea
          className="w-full min-h-[100px] px-3 py-2 rounded border border-light-border bg-light-background text-light-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Any notes about this person, gift ideas, preferences..."
          value={formData.notes || ""}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          maxLength={500}
        />
        <Text size="sm" variant="secondary" className="mt-1">
          Optional - add any private notes or gift ideas
        </Text>
      </div>

      <div className="flex gap-3 pt-4 border-t border-light-border">
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
          disabled={isLoading}
          className="flex-1"
        >
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={isLoading}
          className="flex-1"
        >
          {isEditing ? "Save Changes" : "Add Recipient"}
        </Button>
      </div>
    </form>
  );
}
