"use client";

import { useState, useEffect } from "react";
import { Home, Heart, Briefcase, Users, Lock, Info, ChevronDown } from "lucide-react";
import type { GroupType } from "@/types/privacy";
import { getMyGroups } from "@/lib/actions/groups";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Group {
  id: string;
  name: string;
  group_type: string;
}

interface WishlistPrivacySelectorProps {
  visibleToGroupTypes: GroupType[];
  restrictToGroup: string | null;
  onVisibleToGroupTypesChange: (groupTypes: GroupType[]) => void;
  onRestrictToGroupChange: (groupId: string | null) => void;
  className?: string;
}

const groupTypeConfig = {
  family: { label: 'Family', icon: Home, color: 'text-blue-600 dark:text-blue-400' },
  friends: { label: 'Friends', icon: Heart, color: 'text-pink-600 dark:text-pink-400' },
  work: { label: 'Work', icon: Briefcase, color: 'text-purple-600 dark:text-purple-400' },
  custom: { label: 'Other', icon: Users, color: 'text-gray-600 dark:text-gray-400' },
};

export function WishlistPrivacySelector({
  visibleToGroupTypes,
  restrictToGroup,
  onVisibleToGroupTypesChange,
  onRestrictToGroupChange,
  className,
}: WishlistPrivacySelectorProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchGroups() {
      const result = await getMyGroups();
      if (result.data) {
        setGroups(result.data);
      }
      setLoading(false);
    }
    fetchGroups();
  }, []);

  const toggleGroupType = (groupType: GroupType) => {
    if (visibleToGroupTypes.includes(groupType)) {
      onVisibleToGroupTypesChange(visibleToGroupTypes.filter(t => t !== groupType));
    } else {
      onVisibleToGroupTypesChange([...visibleToGroupTypes, groupType]);
    }
  };

  const isPrivate = visibleToGroupTypes.length === 0 && !restrictToGroup;
  const hasRestriction = restrictToGroup !== null && restrictToGroup !== '';

  return (
    <div className={className}>
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Lock className="w-5 h-5" />
            <Label className="text-base font-semibold">Privacy Settings</Label>
          </div>
          <Text variant="secondary" size="sm">
            Control who can see this wishlist item
          </Text>
        </div>

        {/* Group Type Checkboxes */}
        <div className="space-y-3">
          <Label>Who can see this item?</Label>
          <Text variant="secondary" size="sm">
            Select the types of groups that can view this item
          </Text>

          <div className="space-y-2">
            {(Object.keys(groupTypeConfig) as GroupType[]).map((groupType) => {
              const config = groupTypeConfig[groupType];
              const Icon = config.icon;
              const isChecked = visibleToGroupTypes.includes(groupType);

              return (
                <label
                  key={groupType}
                  className={`
                    flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                    ${isChecked
                      ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                      : 'border-light-border dark:border-dark-border hover:bg-light-background-hover dark:hover:bg-dark-background-hover'
                    }
                  `}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleGroupType(groupType)}
                    className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                  />
                  <Icon className={`w-5 h-5 ${config.color}`} />
                  <div className="flex-1">
                    <Text className="font-medium">{config.label}</Text>
                  </div>
                </label>
              );
            })}
          </div>
        </div>

        {/* Single Group Restriction */}
        {!loading && groups.length > 0 && (
          <div className="space-y-3">
            <Label>Or restrict to a single group (Optional)</Label>
            <Text variant="secondary" size="sm">
              If you select a specific group, only members of that group can see this item
            </Text>
            <Select
              value={restrictToGroup || "none"}
              onValueChange={(value) => onRestrictToGroupChange(value === "none" ? null : value)}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="No restriction" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  <span className="text-light-text-secondary dark:text-dark-text-secondary">
                    No restriction
                  </span>
                </SelectItem>
                {groups.map((group) => (
                  <SelectItem key={group.id} value={group.id}>
                    <div className="flex items-center gap-2">
                      <span>{group.name}</span>
                      <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary">
                        ({group.group_type})
                      </span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Privacy Status Display */}
        <div className={`p-3 rounded-lg border ${
          isPrivate
            ? 'border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20'
            : hasRestriction
            ? 'border-orange-300 dark:border-orange-700 bg-orange-50 dark:bg-orange-900/20'
            : 'border-green-300 dark:border-green-700 bg-green-50 dark:bg-green-900/20'
        }`}>
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4" />
            <Text size="sm" className={
              isPrivate
                ? 'text-gray-600 dark:text-gray-400'
                : hasRestriction
                ? 'text-orange-700 dark:text-orange-300'
                : 'text-green-700 dark:text-green-300'
            }>
              {isPrivate ? (
                <><strong>Private:</strong> Only you can see this item</>
              ) : hasRestriction ? (
                <><strong>Restricted:</strong> Only members of {groups.find(g => g.id === restrictToGroup)?.name} can see this</>
              ) : (
                <><strong>Shared with:</strong> {visibleToGroupTypes.map(t => groupTypeConfig[t].label).join(', ')} groups</>
              )}
            </Text>
          </div>
        </div>

        {!loading && groups.length === 0 && (
          <div className="p-3 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/20">
            <Text size="sm" className="text-gray-600 dark:text-gray-400">
              <Info className="inline w-4 h-4 mr-1" />
              You're not in any groups yet. Create or join groups to share wishlist items.
            </Text>
          </div>
        )}
      </div>
    </div>
  );
}
