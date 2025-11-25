"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { createGift, updateGift } from "@/lib/actions/gift-tracking";
import {
  giftStatuses,
  STATUS_INFO,
  OCCASIONS,
  type TrackedGiftFormData,
  type GiftStatus,
} from "@/lib/schemas/gift-tracking";

interface Recipient {
  id: string;
  name: string;
}

interface GiftFormProps {
  recipients: Recipient[];
  defaultRecipientId?: string;
  gift?: {
    id: string;
    recipient_id: string;
    name: string;
    description: string | null;
    photo_url: string | null;
    product_link: string | null;
    price: number | null;
    status: GiftStatus;
    occasion: string | null;
    season_year: number;
    notes: string | null;
  };
  onSuccess?: (gift: { id: string }) => void;
}

export function GiftForm({
  recipients,
  defaultRecipientId,
  gift,
  onSuccess,
}: GiftFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEditing = !!gift;

  const [formData, setFormData] = useState<Partial<TrackedGiftFormData>>({
    recipient_id: gift?.recipient_id || defaultRecipientId || "",
    name: gift?.name || "",
    description: gift?.description || "",
    photo_url: gift?.photo_url || "",
    product_link: gift?.product_link || "",
    price: gift?.price || undefined,
    status: gift?.status || "planned",
    occasion: gift?.occasion || "",
    season_year: gift?.season_year || new Date().getFullYear(),
    notes: gift?.notes || "",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    if (!formData.recipient_id) {
      setError("Please select a recipient");
      setIsLoading(false);
      return;
    }

    const result = isEditing
      ? await updateGift(gift.id, formData as TrackedGiftFormData)
      : await createGift(formData as TrackedGiftFormData);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      if (onSuccess) {
        onSuccess(result.data);
      } else {
        router.push(`/gift-tracker/${formData.recipient_id}`);
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

      {/* Recipient Selection */}
      <div>
        <label className="block mb-2">
          <Text size="sm" className="font-medium">
            Recipient *
          </Text>
        </label>
        <select
          className="w-full px-3 py-2 rounded border border-light-border bg-light-background text-light-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
          value={formData.recipient_id}
          onChange={(e) =>
            setFormData({ ...formData, recipient_id: e.target.value })
          }
          required
        >
          <option value="">Select a recipient...</option>
          {recipients.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>

      {/* Basic Info */}
      <div className="space-y-4">
        <Heading level="h3">Gift Details</Heading>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Gift Name *
            </Text>
          </label>
          <Input
            type="text"
            placeholder="e.g., Blue sweater, AirPods, Cookbook"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
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
            className="w-full min-h-[80px] px-3 py-2 rounded border border-light-border bg-light-background text-light-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Size, color, model, or other details..."
            value={formData.description || ""}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
            maxLength={1000}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Price
              </Text>
            </label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={formData.price || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  price: e.target.value ? parseFloat(e.target.value) : undefined,
                })
              }
            />
          </div>

          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Occasion
              </Text>
            </label>
            <select
              className="w-full px-3 py-2 rounded border border-light-border bg-light-background text-light-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              value={formData.occasion || ""}
              onChange={(e) =>
                setFormData({ ...formData, occasion: e.target.value })
              }
            >
              <option value="">Select occasion...</option>
              {OCCASIONS.map((occasion) => (
                <option key={occasion} value={occasion}>
                  {occasion}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="space-y-4">
        <Heading level="h3">Links</Heading>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Product Link
            </Text>
          </label>
          <Input
            type="url"
            placeholder="https://example.com/product"
            value={formData.product_link || ""}
            onChange={(e) =>
              setFormData({ ...formData, product_link: e.target.value })
            }
          />
          <Text size="sm" variant="secondary" className="mt-1">
            Link to purchase the item
          </Text>
        </div>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Photo URL
            </Text>
          </label>
          <Input
            type="url"
            placeholder="https://example.com/image.jpg"
            value={formData.photo_url || ""}
            onChange={(e) =>
              setFormData({ ...formData, photo_url: e.target.value })
            }
          />
          <Text size="sm" variant="secondary" className="mt-1">
            Image URL for the gift
          </Text>
        </div>
      </div>

      {/* Status */}
      <div className="space-y-4">
        <Heading level="h3">Status</Heading>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Status
            </Text>
          </label>
          <select
            className="w-full px-3 py-2 rounded border border-light-border bg-light-background text-light-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            value={formData.status}
            onChange={(e) =>
              setFormData({ ...formData, status: e.target.value as GiftStatus })
            }
          >
            {giftStatuses.map((status) => (
              <option key={status} value={status}>
                {STATUS_INFO[status].label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="block mb-2">
          <Text size="sm" className="font-medium">
            Private Notes
          </Text>
        </label>
        <textarea
          className="w-full min-h-[80px] px-3 py-2 rounded border border-light-border bg-light-background text-light-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
          placeholder="Any notes, reminders, or tracking info..."
          value={formData.notes || ""}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          maxLength={1000}
        />
      </div>

      {/* Submit */}
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
          {isEditing ? "Save Changes" : "Add Gift"}
        </Button>
      </div>
    </form>
  );
}
