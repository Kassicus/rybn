"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Heading, Text } from "@/components/ui/text";
import { createGiftExchange } from "@/lib/actions/gift-exchange";
import type { GiftExchangeFormData } from "@/lib/schemas/gift-exchange";

interface ExchangeFormProps {
  groupId: string;
}

export function ExchangeForm({ groupId }: ExchangeFormProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState<Partial<GiftExchangeFormData>>({
    group_id: groupId,
    exchange_type: "secret_santa",
    is_active: true,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    const result = await createGiftExchange(formData as GiftExchangeFormData);

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      // Use window.location for a full page reload to ensure auth context is fresh
      window.location.href = `/gift-exchange/${result.data.id}`;
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div className="p-4 rounded-lg bg-error-light dark:bg-error-dark border border-error">
          <Text variant="error">{error}</Text>
        </div>
      )}

      {/* Basic Info */}
      <div className="space-y-4">
        <Heading level="h3">Basic Information</Heading>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Exchange Name *
            </Text>
          </label>
          <Input
            type="text"
            placeholder="e.g., Family Secret Santa 2024"
            value={formData.name || ""}
            onChange={(e) =>
              setFormData({ ...formData, name: e.target.value })
            }
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
            className="w-full min-h-[100px] px-3 py-2 rounded border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background-secondary text-light-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Add details about the exchange..."
            value={formData.description || ""}
            onChange={(e) =>
              setFormData({ ...formData, description: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Exchange Type
            </Text>
          </label>
          <select
            className="w-full px-3 py-2 rounded border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background-secondary text-light-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            value={formData.exchange_type || "secret_santa"}
            onChange={(e) =>
              setFormData({
                ...formData,
                exchange_type: e.target.value as "secret_santa" | "white_elephant" | "yankee_swap" | "custom",
              })
            }
          >
            <option value="secret_santa">Secret Santa</option>
            <option value="white_elephant">White Elephant</option>
            <option value="yankee_swap">Yankee Swap</option>
            <option value="custom">Custom Exchange</option>
          </select>
        </div>
      </div>

      {/* Budget */}
      <div className="space-y-4">
        <Heading level="h3">Budget</Heading>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Minimum Budget
              </Text>
            </label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={formData.budget_min || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  budget_min: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
            />
          </div>

          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Maximum Budget
              </Text>
            </label>
            <Input
              type="number"
              step="0.01"
              min="0"
              placeholder="0.00"
              value={formData.budget_max || ""}
              onChange={(e) =>
                setFormData({
                  ...formData,
                  budget_max: e.target.value ? parseFloat(e.target.value) : null,
                })
              }
            />
          </div>
        </div>
      </div>

      {/* Event Details */}
      <div className="space-y-4">
        <Heading level="h3">Event Details</Heading>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Exchange Date
            </Text>
          </label>
          <Input
            type="datetime-local"
            value={formData.exchange_date || ""}
            onChange={(e) =>
              setFormData({ ...formData, exchange_date: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Registration Deadline
            </Text>
          </label>
          <Input
            type="datetime-local"
            value={formData.registration_deadline || ""}
            onChange={(e) =>
              setFormData({
                ...formData,
                registration_deadline: e.target.value,
              })
            }
          />
          <Text size="sm" variant="secondary" className="mt-1">
            When should people stop being able to join?
          </Text>
        </div>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Location
            </Text>
          </label>
          <Input
            type="text"
            placeholder="e.g., Mom's house, Virtual, etc."
            value={formData.exchange_location || ""}
            onChange={(e) =>
              setFormData({ ...formData, exchange_location: e.target.value })
            }
          />
        </div>

        <div>
          <label className="block mb-2">
            <Text size="sm" className="font-medium">
              Additional Details
            </Text>
          </label>
          <textarea
            className="w-full min-h-[100px] px-3 py-2 rounded border border-light-border dark:border-dark-border bg-light-background dark:bg-dark-background-secondary text-light-text-primary dark:text-dark-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Add any additional details (rules, preferences, etc.)..."
            value={formData.exchange_details || ""}
            onChange={(e) =>
              setFormData({ ...formData, exchange_details: e.target.value })
            }
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex gap-3 pt-4 border-t border-light-border dark:border-dark-border">
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
          Create Gift Exchange
        </Button>
      </div>
    </form>
  );
}
