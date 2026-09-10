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
    // Five levels against three chromatic families, so the two most
    // restrictive take the neutrals -- which also reads as an escalation
    // from quiet to visible.
    private: "text-ink-muted",
    group: "text-ink-soft",
    friends: "text-accent",
    family: "text-primary",
    public: "text-gold-ink",
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
