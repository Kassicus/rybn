"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, DollarSign } from "lucide-react";
import Link from "next/link";
import { Heading, Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BreadcrumbSetter } from "@/components/layout/BreadcrumbSetter";
import { createGroupGift } from "@/lib/actions/gifts";
import { getMyGroups } from "@/lib/actions/groups";
import { useEffect } from "react";

export default function CreateGiftGroupPage() {
  const router = useRouter();
  const [groups, setGroups] = useState<any[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingGroups, setIsLoadingGroups] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadGroups() {
      const { data } = await getMyGroups();
      setGroups(data || []);
      if (data && data.length > 0) {
        setSelectedGroupId(data[0].id);
      }
      setIsLoadingGroups(false);
    }
    loadGroups();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError("Name is required");
      return;
    }

    if (!selectedGroupId) {
      setError("Please select a group");
      return;
    }

    const parsedAmount = targetAmount ? parseFloat(targetAmount) : null;
    if (targetAmount && (isNaN(parsedAmount as number) || (parsedAmount as number) < 0)) {
      setError("Please enter a valid target amount");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await createGroupGift({
      name: name.trim(),
      description: description.trim() || null,
      group_id: selectedGroupId,
      target_user_id: null,
      target_amount: parsedAmount,
      is_active: true,
    });

    if (result.error) {
      setError(result.error);
      setIsLoading(false);
    } else if (result.data) {
      // Use window.location for a full page reload to ensure auth context is fresh
      window.location.href = `/gifts/${result.data.id}`;
    }
  };

  if (isLoadingGroups) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-center py-16">
          <Text variant="secondary">Loading groups...</Text>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-16 h-16 rounded-full bg-primary-50 flex items-center justify-center mb-4">
            <Gift className="w-8 h-8 text-primary" />
          </div>
          <Heading level="h3" className="mb-2">
            No groups yet
          </Heading>
          <Text variant="secondary" className="max-w-md mb-6">
            You need to be a member of a group to create a group gift. Create or join a group first!
          </Text>
          <Link href="/groups">
            <Button variant="primary">Go to Groups</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <BreadcrumbSetter
        items={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Group Gifts", href: "/gifts" },
          { label: "Create", href: "/gifts/create" },
        ]}
      />
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-lg bg-primary-50 flex items-center justify-center">
            <Gift className="w-6 h-6 text-primary" />
          </div>
          <div>
            <Heading level="h1">Create Group Gift</Heading>
            <Text variant="secondary" className="mt-1">
              Coordinate a group gift with friends and family
            </Text>
          </div>
        </div>
      </div>

      {/* Form */}
      <div className="p-6 rounded-lg border border-light-border bg-light-background">
        {error && (
          <div className="mb-6 p-3 rounded bg-error-light border border-error">
            <Text variant="error" size="sm">
              {error}
            </Text>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Select Group <span className="text-error">*</span>
              </Text>
            </label>
            <select
              value={selectedGroupId}
              onChange={(e) => setSelectedGroupId(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-light-border bg-light-background text-light-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              required
            >
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
            <Text size="sm" variant="secondary" className="mt-1">
              Choose which group this gift coordination is for
            </Text>
          </div>

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
            <Text size="sm" variant="secondary" className="mt-1">
              Give your group gift a descriptive name
            </Text>
          </div>

          <div>
            <label className="block mb-2">
              <Text size="sm" className="font-medium">
                Description
              </Text>
            </label>
            <textarea
              placeholder="What are you planning to get? Any specific ideas or requirements?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={4}
              className="w-full px-3 py-2 rounded-md border border-light-border bg-light-background text-light-text-primary placeholder:text-light-text-secondary focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
            <Text size="sm" variant="secondary" className="mt-1">
              Optional - Add details about the gift or occasion
            </Text>
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
              Optional - Set a fundraising goal for the group
            </Text>
          </div>

          <div className="flex gap-3 pt-4">
            <Link href="/gifts" className="flex-1">
              <Button
                type="button"
                variant="secondary"
                className="w-full"
                disabled={isLoading}
              >
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              variant="primary"
              loading={isLoading}
              className="flex-1"
            >
              <Gift className="w-4 h-4" />
              Create Group Gift
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
