"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  tagItemForMyOccasion,
  tagItemForGroupDate,
  untagItem,
} from "@/lib/actions/item-occasions";
import { occasionLabel, type UpcomingOccasion } from "@/lib/occasions/display";
import {
  untaggedOccasions,
  resolveTaggedChips,
  resolveTagTarget,
} from "@/lib/occasions/taggable";

interface ItemOccasionTagsProps {
  itemId: string;
  /** Occasion ids this item is already tagged for. */
  taggedOccasionIds: string[];
  /**
   * Occasions this OWNER may tag this item toward. Pre-filtered by the page
   * (via taggableOccasions() in lib/occasions/taggable.ts) to the caller's
   * own birthday/anniversary plus every group_date they can see -- never a
   * family member's derived occasion, which tagItemForMyOccasion() has no
   * way to target and would silently mis-tag if offered. See that module's
   * doc comment for the full argument.
   */
  availableOccasions: UpcomingOccasion[];
}

/**
 * Owner-only affordance: which occasion(s) a wishlist item was meant for.
 * Renders removable chips for the tags already on the item, plus a control
 * to add one from `availableOccasions`.
 *
 * ONLY ever mounted by WishlistItemCard when isOwnWishlist is true AND
 * availableOccasions was supplied -- see that component. This file adds no
 * permissions check of its own on top of that: it shows the affordance,
 * calls the action, and renders whatever error string comes back verbatim
 * (the same contract GroupDateActions.tsx and NewGroupDateButton.tsx
 * follow) -- the RLS policies on wishlist_item_occasions are what actually
 * decide whether a write is allowed.
 *
 * Renders nothing claim-derived. Everything on screen here traces back to
 * either `taggedOccasionIds` (getTagsForItems -- item id -> occasion ids,
 * lib/actions/item-occasions.ts; that table has no claim columns to begin
 * with) or `availableOccasions` (getUpcomingOccasions -- UpcomingOccasion in
 * lib/occasions/display.ts, which likewise carries no claim field). Neither
 * source could differ based on whether the item has been claimed.
 *
 * router.refresh() after every successful write, matching GroupDateActions/
 * NewGroupDateButton: the action's own revalidatePath() invalidates the
 * Next.js cache but does not by itself repaint this already-rendered client
 * tree.
 */
export function ItemOccasionTags({
  itemId,
  taggedOccasionIds,
  availableOccasions,
}: ItemOccasionTagsProps) {
  const router = useRouter();
  const [isAdding, setIsAdding] = useState(false);
  const [selectedKey, setSelectedKey] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chips = resolveTaggedChips(taggedOccasionIds, availableOccasions);
  const untagged = untaggedOccasions(availableOccasions, taggedOccasionIds);

  const closeAdd = () => {
    setIsAdding(false);
    setSelectedKey("");
    setError(null);
  };

  const handleAdd = async () => {
    // Keyed by occasionId when there is one, falling back to kind -- the
    // only occasions in `untagged` that can lack an id are the caller's own
    // never-materialized birthday/anniversary, and at most one of each
    // exists, so `kind` alone is unambiguous among them.
    const occasion = untagged.find(
      (o) => (o.occasionId ?? o.kind) === selectedKey
    );
    if (!occasion) return;

    const target = resolveTagTarget(occasion);
    if (!target) return;

    setIsBusy(true);
    setError(null);

    const result =
      target.via === "my"
        ? await tagItemForMyOccasion(itemId, target.kind)
        : await tagItemForGroupDate(itemId, target.occasionId);

    setIsBusy(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    closeAdd();
    router.refresh();
  };

  const handleRemove = async (occasionId: string) => {
    setIsBusy(true);
    setError(null);

    const result = await untagItem(itemId, occasionId);

    setIsBusy(false);

    if ("error" in result) {
      setError(result.error);
      return;
    }

    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      {error && (
        <Text size="sm" className="text-error">
          {error}
        </Text>
      )}

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <span
              key={chip.occasionId}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary"
            >
              <span>
                {chip.label}
                {chip.dateLabel ? ` · ${chip.dateLabel}` : ""}
              </span>
              <button
                type="button"
                onClick={() => handleRemove(chip.occasionId)}
                disabled={isBusy}
                aria-label={`Remove tag for ${chip.label}`}
                className="rounded-full text-primary hover:bg-primary-100 disabled:pointer-events-none disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {availableOccasions.length === 0 ? (
        <Text variant="secondary" size="sm">
          Add your birthday to your profile to tag items for it
        </Text>
      ) : (
        <>
          {!isAdding && untagged.length > 0 && (
            <Button
              variant="tertiary"
              size="small"
              onClick={() => setIsAdding(true)}
              className="self-start"
            >
              <Plus className="h-3.5 w-3.5" />
              Tag for occasion
            </Button>
          )}

          {isAdding && (
            <div className="flex items-center gap-2 flex-wrap">
              <Select value={selectedKey} onValueChange={setSelectedKey}>
                <SelectTrigger className="h-8 w-48 text-sm">
                  <SelectValue placeholder="Choose an occasion" />
                </SelectTrigger>
                <SelectContent>
                  {untagged.map((o) => (
                    <SelectItem
                      key={o.occasionId ?? o.kind}
                      value={o.occasionId ?? o.kind}
                    >
                      {occasionLabel(o)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="primary"
                size="small"
                onClick={handleAdd}
                loading={isBusy}
                disabled={!selectedKey}
              >
                Add
              </Button>
              <Button variant="tertiary" size="small" onClick={closeAdd}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
