"use client";

import { useState } from "react";
import { Home, Heart, Briefcase, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import type { GroupType } from "@/types/privacy";

interface GroupTypeSelectorProps {
  value: GroupType[];
  onChange: (groupTypes: GroupType[]) => void;
  label?: string;
  description?: string;
}

const groupTypeConfig = {
  family: { label: 'Family', icon: Home, color: 'text-blue-600' },
  friends: { label: 'Friends', icon: Heart, color: 'text-pink-600' },
  work: { label: 'Work', icon: Briefcase, color: 'text-purple-600' },
  custom: { label: 'Other', icon: Users, color: 'text-gray-600' },
};

export function GroupTypeSelector({ value, onChange, label, description }: GroupTypeSelectorProps) {
  const toggleGroupType = (groupType: GroupType) => {
    if (value.includes(groupType)) {
      onChange(value.filter(t => t !== groupType));
    } else {
      onChange([...value, groupType]);
    }
  };

  const isPrivate = value.length === 0;

  return (
    <div className="space-y-3">
      {label && <Label>{label}</Label>}
      {description && (
        <Text variant="secondary" size="sm">
          {description}
        </Text>
      )}

      <div className="space-y-2">
        {(Object.keys(groupTypeConfig) as GroupType[]).map((groupType) => {
          const config = groupTypeConfig[groupType];
          const Icon = config.icon;
          const isChecked = value.includes(groupType);

          return (
            <label
              key={groupType}
              className={`
                flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all
                ${isChecked
                  ? 'border-primary-500 bg-primary-50'
                  : 'border-light-border hover:bg-light-background-hover'
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

      <div className={`p-3 rounded-lg border ${
        isPrivate
          ? 'border-gray-300 bg-gray-50'
          : 'border-green-300 bg-green-50'
      }`}>
        <Text size="sm" className={isPrivate ? 'text-gray-600' : 'text-green-700'}>
          {isPrivate ? (
            <>🔒 <strong>Private:</strong> Only you can see these fields</>
          ) : (
            <>✓ <strong>Shared with:</strong> {value.map(t => groupTypeConfig[t].label).join(', ')} groups</>
          )}
        </Text>
      </div>
    </div>
  );
}
