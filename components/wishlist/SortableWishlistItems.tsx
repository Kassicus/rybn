"use client";

import { useState, useMemo } from "react";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { WishlistItemCard } from "./WishlistItemCard";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import type { GroupType } from "@/types/privacy";
import { partitionByOccasion } from "@/lib/occasions/order";

interface ClaimerInfo {
  id: string;
  username: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

interface WishlistItem {
  id: string;
  title: string;
  description?: string | null;
  url?: string | null;
  price?: number | null;
  /** Signed and renderable; expires. */
  image_url?: string | null;
  /** Raw stored value, masked to null when it is another user's object path. */
  image_path?: string | null;
  priority: "low" | "medium" | "high" | "must-have";
  category?: string | null;
  privacy_settings: {
    visibleToGroupTypes: GroupType[];
    restrictToGroup?: string | null;
  };
  claimed_by?: string | null;
  purchased?: boolean;
}

interface SortableWishlistItemsProps {
  items: WishlistItem[];
  currentUserId?: string;
  claimerProfiles?: Record<string, ClaimerInfo>;
  /**
   * Item ids tagged for the ONE occasion currently in view -- already run
   * through itemsTaggedFor() (lib/occasions/order.ts) at the page level, so
   * this is never "has any tag at all." Omitted (the default, empty set)
   * means no occasion grouping applies and this list renders exactly as it
   * did before this feature existed -- see hasOccasionGrouping below.
   */
  occasionTaggedIds?: Set<string>;
  /**
   * Display label for that occasion, e.g. "Jane's Birthday" -- used for both
   * the group heading and the toggle copy. Heading and badge text are driven
   * from this single string (plus occasionId below) so they can never
   * disagree with each other.
   */
  occasionLabel?: string;
  /**
   * The occasion's row id -- null for a derived, unmaterialized birthday.
   * Forwarded to each card as viewedOccasionId, for its badge's label lookup.
   */
  occasionId?: string | null;
}

type SortOption = "priority" | "category" | "price";
type SortDirection = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = {
  "must-have": 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function SortableWishlistItems({
  items,
  currentUserId,
  claimerProfiles = {},
  occasionTaggedIds = new Set<string>(),
  occasionLabel,
  occasionId = null,
}: SortableWishlistItemsProps) {
  const [sortBy, setSortBy] = useState<SortOption>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  // Opt-in, default off: untagged items must stay visible until the viewer
  // explicitly asks to narrow the list down.
  const [onlyTaggedForOccasion, setOnlyTaggedForOccasion] = useState(false);

  const sortedItems = useMemo(() => {
    const sorted = [...items];
    const directionMultiplier = sortDirection === "desc" ? 1 : -1;

    switch (sortBy) {
      case "priority":
        sorted.sort((a, b) => {
          const priorityDiff =
            (PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority]) *
            directionMultiplier;
          if (priorityDiff !== 0) return priorityDiff;
          // Secondary sort by title
          return a.title.localeCompare(b.title);
        });
        break;

      case "category":
        sorted.sort((a, b) => {
          // Items without category go to the end
          if (!a.category && !b.category) return a.title.localeCompare(b.title);
          if (!a.category) return 1;
          if (!b.category) return -1;
          const categoryDiff = a.category.localeCompare(b.category);
          if (categoryDiff !== 0) return categoryDiff;
          // Secondary sort by priority within category
          return PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
        });
        break;

      case "price":
        sorted.sort((a, b) => {
          // Items without price go to the end
          if (a.price == null && b.price == null)
            return a.title.localeCompare(b.title);
          if (a.price == null) return 1;
          if (b.price == null) return -1;
          // Apply direction
          return (b.price - a.price) * directionMultiplier;
        });
        break;
    }

    return sorted;
  }, [items, sortBy, sortDirection]);

  // Occasion grouping is layered ON TOP of the viewer's chosen sort, never
  // instead of it: partitionByOccasion only re-groups sortedItems, an
  // already-sorted array, so each group keeps that sort's relative order.
  //
  // Nothing about this grouping renders unless there is BOTH a label to
  // name it and at least one item actually tagged for it. A celebrant
  // nobody has tagged anything for -- which includes every never-
  // materialized birthday (occasionId: null), per itemsTaggedFor's own null
  // handling upstream -- always produces an empty occasionTaggedIds set, so
  // this falls through to the exact same rendering the list used before
  // this feature existed. That fallback is general (it fires just as
  // readily for a materialized occasion nobody happened to tag), not a
  // special case carved out for the null-id detail.
  const hasOccasionGrouping = !!occasionLabel && occasionTaggedIds.size > 0;

  const { tagged: taggedForOccasion, rest: everythingElse } = useMemo(
    () =>
      hasOccasionGrouping
        ? partitionByOccasion(sortedItems, occasionTaggedIds)
        : { tagged: [] as WishlistItem[], rest: sortedItems },
    [sortedItems, hasOccasionGrouping, occasionTaggedIds]
  );

  const renderCard = (item: WishlistItem) => (
    <WishlistItemCard
      key={item.id}
      item={item as any}
      isOwnWishlist={false}
      currentUserId={currentUserId}
      claimerInfo={item.claimed_by ? claimerProfiles[item.claimed_by] : null}
      viewedOccasionId={occasionId}
      viewedOccasionLabel={occasionLabel ?? null}
      // The same membership test partitionByOccasion used to place this item
      // in taggedForOccasion vs. everythingElse above -- reused here rather
      // than shipping the item's full tag-id array down to the card just so
      // it can check membership in one of them itself (Minor 9).
      taggedForViewedOccasion={occasionTaggedIds.has(item.id)}
    />
  );

  // Shared by every list this component renders (the flat/no-occasion case,
  // and both occasion partitions): category grouping is a presentation
  // choice orthogonal to occasion grouping, so it applies inside each
  // occasion group exactly as it applied to the whole list before.
  const renderList = (list: WishlistItem[]) => {
    if (sortBy !== "category") {
      return <div className="space-y-4">{list.map(renderCard)}</div>;
    }

    const groups: Record<string, WishlistItem[]> = {};
    for (const item of list) {
      const category = item.category || "Uncategorized";
      (groups[category] ??= []).push(item);
    }

    return (
      <div className="space-y-8">
        {Object.entries(groups).map(([category, categoryItems]) => (
          <div key={category} className="space-y-4">
            <div className="flex items-center gap-2">
              <Text className="font-semibold">{category}</Text>
              <span className="px-2 py-0.5 rounded-full text-xs bg-light-background-hover text-light-text-secondary">
                {categoryItems.length}
              </span>
            </div>
            <div className="space-y-4">{categoryItems.map(renderCard)}</div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Sort Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-4 h-4 text-light-text-secondary" />
          <Text size="sm" variant="secondary">
            Sort by
          </Text>
        </div>
        <Select
          value={sortBy}
          onValueChange={(value) => setSortBy(value as SortOption)}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority">Priority</SelectItem>
            <SelectItem value="category">Category</SelectItem>
            <SelectItem value="price">Price</SelectItem>
          </SelectContent>
        </Select>
        {/* Direction toggle - only for priority and price */}
        {sortBy !== "category" && (
          <Button
            variant="secondary"
            size="small"
            onClick={() =>
              setSortDirection((prev) => (prev === "desc" ? "asc" : "desc"))
            }
            className="flex items-center gap-1.5"
          >
            {sortDirection === "desc" ? (
              <>
                <ArrowDown className="w-4 h-4" />
                <span>High to Low</span>
              </>
            ) : (
              <>
                <ArrowUp className="w-4 h-4" />
                <span>Low to High</span>
              </>
            )}
          </Button>
        )}

        {/* Occasion filter - opt-in, default off. Only offered when there is
            at least one item to filter TO -- see hasOccasionGrouping above. */}
        {hasOccasionGrouping && (
          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={onlyTaggedForOccasion}
              onCheckedChange={(checked) =>
                setOnlyTaggedForOccasion(checked === true)
              }
            />
            <Text size="sm" variant="secondary">
              Only show items for {occasionLabel}
            </Text>
          </label>
        )}
      </div>

      {/* Items List */}
      {hasOccasionGrouping ? (
        <div className="space-y-8">
          <div className="space-y-4">
            <Text className="font-semibold">Tagged for {occasionLabel}</Text>
            {renderList(taggedForOccasion)}
          </div>
          {/* Untagged items stay visible below unless the viewer explicitly
              opts into hiding them -- the toggle above, default off. Also
              gated on everythingElse.length: hasOccasionGrouping only
              requires the TAGGED partition be non-empty, so when every item
              on the list is tagged, everythingElse is empty and this heading
              must not render over nothing. */}
          {!onlyTaggedForOccasion && everythingElse.length > 0 && (
            <div className="space-y-4">
              <Text className="font-semibold">Everything else</Text>
              {renderList(everythingElse)}
            </div>
          )}
        </div>
      ) : (
        renderList(sortedItems)
      )}
    </div>
  );
}
