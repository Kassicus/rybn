import { Lock, Users, Heart, Home, Globe } from "lucide-react";
import type { PrivacyLevel } from "@/types/privacy";
import { PRIVACY_LEVELS } from "@/types/privacy";
import { cn } from "@/lib/utils";

interface PrivacyBadgeProps {
  level: PrivacyLevel;
  className?: string;
  showLabel?: boolean;
}

const ICON_MAP = {
  Lock,
  Users,
  Heart,
  Home,
  Globe,
};

export function PrivacyBadge({ level, className, showLabel = true }: PrivacyBadgeProps) {
  const info = PRIVACY_LEVELS[level];
  const IconComponent = ICON_MAP[info.icon as keyof typeof ICON_MAP];

  const colors = {
    private: "text-gray-600",
    group: "text-blue-600",
    friends: "text-pink-600",
    family: "text-green-600",
    public: "text-purple-600",
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <IconComponent className={cn("w-4 h-4", colors[level])} />
      {showLabel && (
        <span className={cn("text-sm", colors[level])}>
          {info.label}
        </span>
      )}
    </div>
  );
}
