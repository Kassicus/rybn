"use client";

import { useEffect, useState } from "react";
import { Users, Lock, UsersRound } from "lucide-react";
import { getMyGroups } from "@/lib/actions/groups";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PrivacyChoice } from "@/lib/wishlist/privacy-choice";

interface Group {
  id: string;
  name: string;
  group_type: string;
}

interface WishlistPrivacySelectorProps {
  choice: PrivacyChoice;
  onChange: (choice: PrivacyChoice) => void;
  className?: string;
}

const OPTIONS = [
  {
    kind: "groups" as const,
    icon: Users,
    label: "Everyone in your groups",
    detail: "Anyone you share a group with can see this item.",
  },
  {
    kind: "group" as const,
    icon: UsersRound,
    label: "Just one group",
    detail: "Only people in the group you pick.",
  },
  {
    kind: "private" as const,
    icon: Lock,
    label: "Only you",
    detail: "Nobody else sees this, not even in a shared group.",
  },
];

/**
 * Three plain choices over a two-axis stored shape. The mapping lives in
 * lib/wishlist/privacy-choice.ts and is tested there; this component only
 * renders it.
 *
 * `legacyTypes` is a fourth state that cannot be chosen -- it appears when an
 * item was saved while the family/friends/work toggles still existed. It is
 * shown as its own selected row so that editing the title of such an item
 * cannot quietly widen who can see it.
 */
export function WishlistPrivacySelector({
  choice,
  onChange,
  className,
}: WishlistPrivacySelectorProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getMyGroups()
      .then((result) => {
        if (cancelled) return;
        setGroups((result.data ?? []) as Group[]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const select = (kind: "groups" | "group" | "private") => {
    if (kind === "group") {
      const existing = choice.kind === "group" ? choice.groupId : "";
      onChange({ kind: "group", groupId: existing });
      return;
    }
    onChange({ kind });
  };

  return (
    <fieldset className={cn("flex flex-col gap-3", className)}>
      <legend className="sr-only">Who can see this item</legend>

      {choice.kind === "legacyTypes" && (
        <div className="rounded-md border border-gold-ink/40 bg-gold-tint p-4">
          <Text size="sm" className="font-semibold text-gold-ink">
            Currently limited to your {choice.types.join(", ")} groups
          </Text>
          <Text size="sm" variant="secondary" className="mt-1">
            This item was saved with an older setting. Leave it as it is, or
            pick one of the options below to change it.
          </Text>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {OPTIONS.map((option) => {
          const checked = choice.kind === option.kind;
          const Icon = option.icon;
          return (
            <label
              key={option.kind}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-md border p-4 transition-colors",
                "focus-within:ring-2 focus-within:ring-accent",
                checked
                  ? "border-primary bg-primary-50"
                  : "border-light-border bg-light-background hover:bg-light-background-hover"
              )}
            >
              <input
                type="radio"
                name="wishlist-privacy"
                className="mt-1 h-4 w-4 shrink-0 accent-primary focus:outline-none"
                checked={checked}
                onChange={() => select(option.kind)}
              />
              <Icon
                className={cn(
                  "mt-0.5 h-5 w-5 shrink-0",
                  checked ? "text-primary" : "text-ink-muted"
                )}
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-semibold">{option.label}</span>
                <Text size="sm" variant="secondary">
                  {option.detail}
                </Text>
              </span>
            </label>
          );
        })}
      </div>

      {choice.kind === "group" && (
        <div className="flex flex-col gap-2 pl-1">
          <Select
            value={choice.groupId || undefined}
            onValueChange={(groupId) => onChange({ kind: "group", groupId })}
          >
            <SelectTrigger className="h-12">
              <SelectValue
                placeholder={loading ? "Loading your groups…" : "Choose a group"}
              />
            </SelectTrigger>
            <SelectContent>
              {groups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!loading && groups.length === 0 && (
            <Text size="sm" variant="secondary">
              You are not in any groups yet, so there is nothing to restrict it
              to.
            </Text>
          )}
        </div>
      )}
    </fieldset>
  );
}
