"use client";

import { Lock, Users, Heart, Home, Globe } from "lucide-react";
import type { PrivacyLevel } from "@/types/privacy";
import { PRIVACY_LEVELS } from "@/types/privacy";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface PrivacySelectorProps {
  value: PrivacyLevel;
  onChange: (value: PrivacyLevel) => void;
  className?: string;
  disabled?: boolean;
}

const ICON_MAP = {
  Lock,
  Users,
  Heart,
  Home,
  Globe,
};

export function PrivacySelector({
  value,
  onChange,
  className,
  disabled = false,
}: PrivacySelectorProps) {
  const selectedInfo = PRIVACY_LEVELS[value];
  const SelectedIcon = ICON_MAP[selectedInfo.icon as keyof typeof ICON_MAP];

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className}>
        <SelectValue>
          <div className="flex items-center gap-2">
            <SelectedIcon className="w-4 h-4" />
            <span>{selectedInfo.label}</span>
          </div>
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {(Object.entries(PRIVACY_LEVELS) as [PrivacyLevel, typeof PRIVACY_LEVELS[PrivacyLevel]][]).map(
          ([level, info]) => {
            const IconComponent = ICON_MAP[info.icon as keyof typeof ICON_MAP];
            return (
              <SelectItem key={level} value={level}>
                <div className="flex flex-col items-start py-1">
                  <div className="flex items-center gap-2 font-medium">
                    <IconComponent className="w-4 h-4" />
                    {info.label}
                  </div>
                  <span className="text-xs text-light-text-secondary dark:text-dark-text-secondary mt-0.5">
                    {info.description}
                  </span>
                </div>
              </SelectItem>
            );
          }
        )}
      </SelectContent>
    </Select>
  );
}
