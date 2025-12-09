"use client";

import {
  Lightbulb,
  ShoppingCart,
  Package,
  Gift,
  CheckCircle2,
  ChevronDown,
} from "lucide-react";
import { STATUS_INFO, type GiftStatus } from "@/lib/schemas/gift-tracking";

const statusIcons = {
  planned: Lightbulb,
  ordered: ShoppingCart,
  arrived: Package,
  wrapped: Gift,
  given: CheckCircle2,
};

interface GiftStatusBadgeProps {
  status: GiftStatus;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}

export function GiftStatusBadge({
  status,
  showLabel = true,
  size = "md",
  onClick,
}: GiftStatusBadgeProps) {
  const info = STATUS_INFO[status];
  const Icon = statusIcons[status];

  const sizeClasses = {
    sm: "px-1.5 py-0.5 text-xs gap-1",
    md: "px-2 py-1 text-sm gap-1.5",
    lg: "px-3 py-1.5 text-base gap-2",
  };

  const iconSizes = {
    sm: "w-3 h-3",
    md: "w-4 h-4",
    lg: "w-5 h-5",
  };

  const chevronSizes = {
    sm: "w-3 h-3",
    md: "w-3.5 h-3.5",
    lg: "w-4 h-4",
  };

  const baseClasses = `inline-flex items-center rounded-full font-medium ${sizeClasses[size]}`;
  const interactiveClasses = onClick
    ? "cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-current/30 transition-all"
    : "";

  return (
    <span
      className={`${baseClasses} ${interactiveClasses}`}
      style={{ backgroundColor: info.hexBgColor, color: info.hexColor }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <Icon className={iconSizes[size]} />
      {showLabel && <span>{info.label}</span>}
      {onClick && <ChevronDown className={`${chevronSizes[size]} opacity-60`} />}
    </span>
  );
}
