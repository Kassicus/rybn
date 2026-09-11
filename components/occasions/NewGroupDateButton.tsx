"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Heading, Text } from "@/components/ui/text";
import { createGroupDate } from "@/lib/actions/occasions";

interface NewGroupDateButtonProps {
  groupId: string;
}

/**
 * The "New occasion" affordance for a group page, wired to createGroupDate
 * (Task 5). Hand-rolled modal rather than a shared Dialog primitive, matching
 * InviteMembersButton.tsx -- this app has no such primitive yet.
 *
 * createGroupDate revalidates this route's path server-side, but that only
 * invalidates the Next.js cache -- it does not by itself repaint a client
 * component's already-rendered tree. router.refresh() is what asks the
 * router to re-fetch the now-invalidated RSC payload, the same pairing
 * app/(dashboard)/wishlist/add/page.tsx uses after createWishlistItem.
 */
export function NewGroupDateButton({ groupId }: NewGroupDateButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [occasionDate, setOccasionDate] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setIsOpen(false);
    setName("");
    setOccasionDate("");
    setError(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) {
      setError("Give this occasion a name");
      return;
    }
    if (!occasionDate) {
      setError("Pick a date");
      return;
    }

    setIsLoading(true);
    setError(null);

    const result = await createGroupDate({ groupId, name, occasionDate });

    setIsLoading(false);

    if (result.error) {
      setError(result.error);
      return;
    }

    close();
    router.refresh();
  };

  if (!isOpen) {
    return (
      <Button variant="secondary" size="small" onClick={() => setIsOpen(true)}>
        <Plus className="h-4 w-4" />
        New occasion
      </Button>
    );
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={close}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md space-y-4 rounded-lg border border-light-border bg-light-background p-6">
          <div className="flex items-start justify-between">
            <div>
              <Heading level="h3">New occasion</Heading>
              <Text variant="secondary" size="sm">
                Every member of this group will see it
              </Text>
            </div>
            <button
              onClick={close}
              className="text-light-text-secondary hover:text-light-text-primary"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {error && (
            <div className="rounded border border-error bg-error-light p-3">
              <Text variant="error" size="sm">
                {error}
              </Text>
            </div>
          )}

          <div>
            <Label htmlFor="occasion-name">Name</Label>
            <Input
              id="occasion-name"
              placeholder="Christmas 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
              }}
              className="mt-1"
            />
          </div>

          <div>
            <Label htmlFor="occasion-date">Date</Label>
            <Input
              id="occasion-date"
              type="date"
              value={occasionDate}
              onChange={(e) => setOccasionDate(e.target.value)}
              className="mt-1"
            />
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" onClick={close} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              loading={isLoading}
              className="flex-1"
            >
              <CalendarPlus className="h-4 w-4" />
              Add occasion
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
