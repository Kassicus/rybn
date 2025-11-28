"use client";

import { useState, useMemo } from "react";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
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

interface WishlistItem {
  id: string;
  title: string;
  description?: string | null;
  url?: string | null;
  price?: number | null;
  image_url?: string | null;
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
}

type SortOption = "priority" | "category" | "price";
type SortDirection = "asc" | "desc";

const PRIORITY_ORDER: Record<string, number> = {
  "must-have": 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function SortableWishlistItems({ items }: SortableWishlistItemsProps) {
  const [sortBy, setSortBy] = useState<SortOption>("priority");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Get unique categories for display
  const categories = useMemo(() => {
    const cats = new Set<string>();
    items.forEach((item) => {
      if (item.category) cats.add(item.category);
    });
    return Array.from(cats).sort();
  }, [items]);

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

  // Group items by category when sorting by category
  const groupedItems = useMemo(() => {
    if (sortBy !== "category") return null;

    const groups: Record<string, WishlistItem[]> = {};
    sortedItems.forEach((item) => {
      const category = item.category || "Uncategorized";
      if (!groups[category]) groups[category] = [];
      groups[category].push(item);
    });
    return groups;
  }, [sortedItems, sortBy]);

  return (
    <div className="space-y-6">
      {/* Sort Controls */}
      <div className="flex items-center gap-3">
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
      </div>

      {/* Items List */}
      {sortBy === "category" && groupedItems ? (
        // Grouped by category
        <div className="space-y-8">
          {Object.entries(groupedItems).map(([category, categoryItems]) => (
            <div key={category} className="space-y-4">
              <div className="flex items-center gap-2">
                <Text className="font-semibold">{category}</Text>
                <span className="px-2 py-0.5 rounded-full text-xs bg-light-background-hover text-light-text-secondary">
                  {categoryItems.length}
                </span>
              </div>
              <div className="space-y-4">
                {categoryItems.map((item) => (
                  <WishlistItemCard
                    key={item.id}
                    item={item as any}
                    isOwnWishlist={false}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Flat list
        <div className="space-y-4">
          {sortedItems.map((item) => (
            <WishlistItemCard
              key={item.id}
              item={item as any}
              isOwnWishlist={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
