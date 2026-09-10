import { Info } from "lucide-react";
import { Text } from "@/components/ui/text";
import type { PrivacyLevel } from "@/types/privacy";

interface PrivacyInfoProps {
  level: PrivacyLevel;
}

export function PrivacyInfo({ level }: PrivacyInfoProps) {
  const descriptions = {
    private: "Only you can see these fields",
    group: "Visible to all group members",
    friends: "Visible to friends-type groups only",
    family: "Visible to family-type groups only",
    public: "Visible to everyone",
  };

  return (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-primary-50 border border-primary-200">
      <Info className="w-4 h-4 mt-0.5 text-primary flex-shrink-0" />
      <div>
        <Text size="sm" className="text-primary">
          <strong>Default Privacy: {level.charAt(0).toUpperCase() + level.slice(1)}</strong>
        </Text>
        <Text size="sm" variant="secondary" className="mt-0.5">
          {descriptions[level]} (You can customize privacy per-field in a future update)
        </Text>
      </div>
    </div>
  );
}
