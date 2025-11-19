import { Lock } from "lucide-react";
import { Text } from "@/components/ui/text";
import { PrivacyBadge } from "@/components/privacy/PrivacyBadge";
import { formatProfileDate } from "@/lib/utils/dates";
import type { PrivacyLevel } from "@/types/privacy";

interface ProfileFieldProps {
  label: string;
  value?: string | null;
  privacyLevel?: PrivacyLevel;
  isVisible?: boolean;
  isDate?: boolean;
  className?: string;
}

export function ProfileField({
  label,
  value,
  privacyLevel,
  isVisible = true,
  isDate = false,
  className = "",
}: ProfileFieldProps) {
  if (!isVisible) {
    return (
      <div className={`p-4 rounded-lg border border-light-border bg-light-background-hover ${className}`}>
        <div className="flex items-center gap-2 text-light-text-secondary">
          <Lock className="w-4 h-4" />
          <Text variant="secondary" size="sm">
            This information is private
          </Text>
        </div>
      </div>
    );
  }

  // Format the value if it's a date
  const displayValue = isDate && value ? formatProfileDate(value) : value;

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <Text size="sm" variant="secondary">
          {label}
        </Text>
        {privacyLevel && <PrivacyBadge level={privacyLevel} showLabel={false} />}
      </div>
      <Text className="font-medium">
        {displayValue || <span className="text-light-text-secondary">Not set</span>}
      </Text>
    </div>
  );
}
